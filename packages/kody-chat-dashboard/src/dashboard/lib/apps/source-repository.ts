const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseGitHubRepository(value: string): GitHubRepositoryRef {
  const raw = value.trim();
  let parts: string[];
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("invalid_github_repository");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("invalid_github_repository");
    parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  } else {
    parts = raw.replace(/^\/+|\/+$/g, "").split("/");
  }
  if (parts.length !== 2) throw new Error("invalid_github_repository");
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo))
    throw new Error("invalid_github_repository");
  return { owner, repo, fullName: `${owner}/${repo}` };
}
