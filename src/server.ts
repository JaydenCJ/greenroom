/**
 * HTTP server: webhook receiver plus a small read-only API.
 *
 *   POST /webhook           GitHub webhook endpoint (signature required)
 *   GET  /health            liveness probe
 *   GET  /api/environments  current environment records
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Config } from './config';
import type { Logger } from './logger';
import type { Orchestrator } from './core/orchestrator';
import type { EnvironmentStore } from './core/store';
import type { JobQueue } from './queue';
import { composeProjectName } from './core/names';
import { routeEvent } from './webhook/router';
import { verifySignature } from './webhook/verify';
import { VERSION } from './version';

const MAX_BODY_BYTES = 1024 * 1024;

export interface ServerDeps {
  config: Config;
  store: EnvironmentStore;
  queue: JobQueue;
  orchestrator: Orchestrator;
  logger: Logger;
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Pause instead of destroying the socket so a 413 response can
        // still reach the client; the connection is closed after that.
        req.pause();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export function createServer(deps: ServerDeps): Server {
  const { config, store, queue, orchestrator, logger } = deps;

  return createHttpServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof BodyTooLargeError) {
        res.writeHead(413, {
          'content-type': 'application/json; charset=utf-8',
          connection: 'close',
        });
        // Destroy the socket once the response is flushed: the client got
        // its 413 and cannot keep streaming an oversized body.
        res.end(JSON.stringify({ error: 'payload too large' }), () => {
          res.socket?.destroy();
        });
        return;
      }
      logger.error(`unhandled request error: ${(error as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return sendJson(res, 200, { status: 'ok', version: VERSION, dryRun: config.dryRun });
    }

    if (url.pathname === '/api/environments') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return sendJson(res, 200, { environments: store.list() });
    }

    if (url.pathname === '/webhook') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readBody(req);
      const delivery = String(req.headers['x-github-delivery'] ?? 'unknown');
      const signature = req.headers['x-hub-signature-256'];

      if (!verifySignature(config.webhookSecret, body, typeof signature === 'string' ? signature : undefined)) {
        logger.warn(`webhook delivery ${delivery}: signature verification failed`);
        return sendJson(res, 401, { error: 'invalid signature' });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'body is not valid JSON' });
      }

      const eventName = String(req.headers['x-github-event'] ?? '');
      const routed = routeEvent(eventName, payload);

      switch (routed.kind) {
        case 'ping':
          return sendJson(res, 200, { ok: true, pong: true });
        case 'ignored':
          logger.debug(`webhook delivery ${delivery} ignored: ${routed.reason}`);
          return sendJson(res, 200, { ok: true, ignored: true, reason: routed.reason });
        case 'invalid':
          logger.warn(`webhook delivery ${delivery} invalid: ${routed.reason}`);
          return sendJson(res, 400, { error: routed.reason });
        case 'deploy': {
          if (!orchestrator.isAllowed(routed.pr.repo.fullName)) {
            logger.warn(`webhook delivery ${delivery}: repo ${routed.pr.repo.fullName} not allowed`);
            return sendJson(res, 403, { error: 'repository not in ALLOWED_REPOS' });
          }
          const project = composeProjectName(routed.pr.repo.owner, routed.pr.repo.name, routed.pr.number);
          void queue.push(`deploy ${project}`, async () => {
            await orchestrator.deploy(routed.pr);
          });
          return sendJson(res, 202, { ok: true, queued: 'deploy', project });
        }
        case 'destroy': {
          const project = composeProjectName(routed.pr.repo.owner, routed.pr.repo.name, routed.pr.number);
          const reason = routed.merged ? 'merged' : 'closed';
          void queue.push(`destroy ${project}`, async () => {
            await orchestrator.destroy(project, reason);
          });
          return sendJson(res, 202, { ok: true, queued: 'destroy', project, reason });
        }
      }
    }

    sendJson(res, 404, { error: 'not found' });
  }
}
