/**
 * Webhook event routing. Maps a verified GitHub event (name + JSON payload)
 * to one of the actions greenroom knows how to perform. Pure logic, no I/O,
 * fully covered by fixture tests.
 */

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
}

export interface PullRequestInfo {
  repo: RepoRef;
  number: number;
  headSha: string;
  headRef: string;
  title: string;
}

export type RoutedEvent =
  | { kind: 'deploy'; action: 'opened' | 'reopened' | 'synchronize'; pr: PullRequestInfo }
  | { kind: 'destroy'; action: 'closed'; merged: boolean; pr: PullRequestInfo }
  | { kind: 'ping' }
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractPullRequest(payload: Record<string, unknown>): PullRequestInfo | null {
  const pr = asRecord(payload.pull_request);
  const repository = asRecord(payload.repository);
  if (!pr || !repository) return null;

  const head = asRecord(pr.head);
  const owner = asRecord(repository.owner);
  const number = pr.number;
  const headSha = head ? str(head.sha) : null;
  const headRef = head ? str(head.ref) : null;
  const name = str(repository.name);
  const fullName = str(repository.full_name);
  const cloneUrl = str(repository.clone_url);
  const ownerLogin = owner ? str(owner.login) : null;

  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
  if (!headSha || !headRef || !name || !fullName || !cloneUrl || !ownerLogin) return null;

  return {
    repo: { owner: ownerLogin, name, fullName, cloneUrl },
    number,
    headSha,
    headRef,
    title: str(pr.title) ?? '',
  };
}

const DEPLOY_ACTIONS = new Set(['opened', 'reopened', 'synchronize']);

/** Route a webhook event. The payload must already be signature-verified. */
export function routeEvent(eventName: string, payload: unknown): RoutedEvent {
  if (eventName === 'ping') return { kind: 'ping' };
  if (eventName !== 'pull_request') {
    return { kind: 'ignored', reason: `event "${eventName}" is not handled` };
  }

  const body = asRecord(payload);
  if (!body) return { kind: 'invalid', reason: 'payload is not a JSON object' };

  const action = str(body.action);
  if (!action) return { kind: 'invalid', reason: 'pull_request payload has no action' };

  if (!DEPLOY_ACTIONS.has(action) && action !== 'closed') {
    return { kind: 'ignored', reason: `pull_request action "${action}" is not handled` };
  }

  const pr = extractPullRequest(body);
  if (!pr) return { kind: 'invalid', reason: 'pull_request payload is missing required fields' };

  if (action === 'closed') {
    const prBody = asRecord(body.pull_request);
    const merged = prBody ? prBody.merged === true : false;
    return { kind: 'destroy', action: 'closed', merged, pr };
  }

  return { kind: 'deploy', action: action as 'opened' | 'reopened' | 'synchronize', pr };
}
