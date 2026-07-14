/**
 * PR comment rendering. Greenroom keeps exactly one bot comment per PR and
 * edits it in place on every status change. The hidden marker makes the
 * comment identifiable and keeps updates idempotent.
 */
import type { EnvironmentRecord } from './store';

export function commentMarker(project: string): string {
  return `<!-- greenroom:${project} -->`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const STATUS_LABEL: Record<EnvironmentRecord['status'], string> = {
  deploying: 'Deploying',
  running: 'Ready',
  failed: 'Failed',
  destroyed: 'Destroyed',
};

/** Render the full markdown body of the bot comment for a record. */
export function renderComment(record: EnvironmentRecord): string {
  const lines: string[] = [commentMarker(record.project), '### Greenroom preview', ''];

  const rows: Array<[string, string]> = [['Status', STATUS_LABEL[record.status]]];

  if (record.status === 'running') {
    rows.push(['Preview', record.url]);
  }
  rows.push(['Commit', `\`${shortSha(record.headSha)}\``]);
  if (record.status === 'running' && record.expiresAt) {
    rows.push(['Expires', record.expiresAt.replace(/\.\d{3}Z$/, 'Z')]);
  }
  if (record.status === 'failed' && record.lastError) {
    rows.push(['Error', record.lastError.split('\n')[0] ?? '']);
  }
  if (record.status === 'destroyed' && record.destroyedReason) {
    rows.push(['Reason', record.destroyedReason]);
  }

  lines.push('| | |');
  lines.push('|---|---|');
  for (const [key, value] of rows) {
    lines.push(`| **${key}** | ${value} |`);
  }
  lines.push('');

  switch (record.status) {
    case 'deploying':
      lines.push('_Building the preview environment for this pull request..._');
      break;
    case 'running':
      lines.push(
        '_The preview is protected by basic auth. It is destroyed automatically when this PR closes or the TTL expires._',
      );
      break;
    case 'failed':
      lines.push('_Deployment failed. Push a new commit to retry, or check the greenroom logs._');
      break;
    case 'destroyed':
      lines.push('_This preview environment has been torn down and its resources reclaimed._');
      break;
  }

  return lines.join('\n');
}
