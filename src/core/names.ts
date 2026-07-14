/**
 * Naming rules for compose projects and preview subdomains.
 *
 * - Compose project names must match [a-z0-9][a-z0-9_-]* (docker compose rule).
 * - DNS labels must be <= 63 chars, lowercase alphanumerics and hyphens,
 *   and must not start or end with a hyphen.
 * - Both names include the repository owner, so two repositories with the
 *   same name under different owners can never collide on one instance.
 */

/** Max chars of the sanitized owner name kept inside generated names. */
const OWNER_SLUG_MAX = 20;

/** Max chars of the sanitized repo name kept inside generated names. */
const REPO_SLUG_MAX = 40;

/**
 * Lowercase a raw name and reduce it to [a-z0-9-]. Runs of invalid
 * characters collapse into a single hyphen; leading/trailing hyphens are
 * trimmed; the result is truncated to maxLength (without a trailing hyphen).
 */
export function sanitizeSlug(raw: string, maxLength: number = REPO_SLUG_MAX): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'repo';
}

/** Compose project name for a PR environment: gr-<owner>-<repo>-<pr>. */
export function composeProjectName(owner: string, repoName: string, prNumber: number): string {
  return `gr-${sanitizeSlug(owner, OWNER_SLUG_MAX)}-${sanitizeSlug(repoName)}-${prNumber}`;
}

/**
 * Leftmost DNS label for a preview URL: <pr>-<owner>-<repo>, truncated so
 * the whole label stays within the 63-char DNS limit.
 */
export function subdomainLabel(owner: string, repoName: string, prNumber: number): string {
  const prefix = `${prNumber}-${sanitizeSlug(owner, OWNER_SLUG_MAX)}-`;
  const budget = 63 - prefix.length;
  return `${prefix}${sanitizeSlug(repoName, budget)}`;
}

/** Fully qualified preview host: <pr>-<owner>-<repo>.<baseDomain>. */
export function previewSubdomain(
  owner: string,
  repoName: string,
  prNumber: number,
  baseDomain: string,
): string {
  return `${subdomainLabel(owner, repoName, prNumber)}.${baseDomain}`;
}

/** Public HTTPS URL of a preview environment. */
export function previewUrl(owner: string, repoName: string, prNumber: number, baseDomain: string): string {
  return `https://${previewSubdomain(owner, repoName, prNumber, baseDomain)}`;
}
