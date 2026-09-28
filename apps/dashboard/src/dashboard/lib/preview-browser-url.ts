/**
 * @fileType module
 * @domain preview
 * @pattern preview-browser-url-sync
 * @ai-summary Pure URL acceptance rules for PreviewBrowser's automatic address
 *   sync. Keeps embedded third-party iframe URLs out of the preview chrome.
 */

function parseUrl(url: string | null | undefined, origin: string): URL | null {
  if (!url) return null;
  try {
    return new URL(url, origin);
  } catch {
    return null;
  }
}

function repoViewMountPath(pathname: string): string | null {
  const tokenized = pathname.match(
    /^\/api\/kody\/views\/_t\/[^/]+\/[^/]+(?=\/|$)/,
  );
  if (tokenized) return tokenized[0];

  const direct = pathname.match(/^\/api\/kody\/views\/(?!_t\/)[^/]+(?=\/|$)/);
  return direct?.[0] ?? null;
}

export function shouldSyncPreviewBrowserUrl(
  candidateUrl: string | null | undefined,
  activePreviewUrl: string | null | undefined,
  dashboardOrigin: string,
): boolean {
  const candidate = parseUrl(candidateUrl, dashboardOrigin);
  const active = parseUrl(activePreviewUrl, dashboardOrigin);
  if (!candidate || !active) return false;
  if (candidate.origin !== active.origin) return false;

  const activeRepoViewMount = repoViewMountPath(active.pathname);
  if (!activeRepoViewMount) return true;

  return repoViewMountPath(candidate.pathname) === activeRepoViewMount;
}
