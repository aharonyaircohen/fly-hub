import {
  savedAppFromManifest,
  savedAppPackage,
  type SavedApp,
  savedIdPattern,
} from "./app-image-format.ts";

export async function registryBearer(
  user: string,
  token: string,
  actions = "pull",
) {
  const url = new URL("https://ghcr.io/token");
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set(
    "scope",
    `repository:${user.toLowerCase()}/${savedAppPackage}:${actions}`,
  );
  const response = await fetch(url, {
    headers: {
      authorization: `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "GitHub registry access was denied. Connect a classic GitHub token with read:packages and write:packages.",
    );
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub registry returned no access token.");
  return body.token;
}
export async function registryManifest(
  user: string,
  bearer: string,
  tag: string,
) {
  const response = await fetch(
    `https://ghcr.io/v2/${user.toLowerCase()}/${savedAppPackage}/manifests/${encodeURIComponent(tag)}`,
    {
      headers: {
        authorization: `Bearer ${bearer}`,
        accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("Saved app image could not be read.");
  return response.json() as Promise<{
    annotations?: Record<string, string>;
    layers?: Array<{ size?: number }>;
  }>;
}
export async function listSavedApps(
  user: string,
  token: string,
): Promise<SavedApp[]> {
  if (!(await assertPrivatePackage(user, token, true))) return [];
  const bearer = await registryBearer(user, token);
  let url: string | null =
    `https://ghcr.io/v2/${user.toLowerCase()}/${savedAppPackage}/tags/list?n=100`;
  const tags: string[] = [];
  while (url) {
    const response: Response = await fetch(url, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Could not list saved apps in GHCR.");
    const body = (await response.json()) as { tags?: string[] };
    tags.push(...(body.tags ?? []).filter((t) => /^app-[a-f0-9]{32}$/.test(t)));
    const next: string | undefined = response.headers
      .get("link")
      ?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    const nextUrl: URL | null = next ? new URL(next, url) : null;
    if (nextUrl && nextUrl.origin !== "https://ghcr.io")
      throw new Error("Invalid registry pagination.");
    url = nextUrl?.href ?? null;
    if (tags.length > 1000)
      throw new Error("Saved app catalog exceeds 1000 versions.");
  }
  const apps: SavedApp[] = [];
  // Bound parallelism: larger catalogs should not fire hundreds of registry calls at once.
  for (let i = 0; i < tags.length; i += 8) {
    const batch = await Promise.all(
      tags
        .slice(i, i + 8)
        .map(async (tag) =>
          savedAppFromManifest(
            await registryManifest(user, bearer, tag),
            user,
            tag,
          ),
        ),
    );
    apps.push(...batch.filter((app): app is SavedApp => app !== null));
  }
  return apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function assertPrivatePackage(
  user: string,
  token: string,
  allowMissing: boolean,
) {
  const response = await fetch(
    `https://api.github.com/user/packages/container/${savedAppPackage}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );
  if (response.status === 404 && allowMissing) return false;
  if (!response.ok)
    throw new Error(
      "Cannot verify GHCR package privacy. Check read:packages permission.",
    );
  const body = (await response.json()) as {
    visibility?: string;
    owner?: { login?: string };
  };
  if (
    body.visibility !== "private" ||
    body.owner?.login?.toLowerCase() !== user.toLowerCase()
  )
    throw new Error(
      "Saved apps must use your private flyhub-saved-apps GHCR package.",
    );
  return true;
}

export async function deleteSavedAppVersion(
  user: string,
  token: string,
  id: string,
) {
  if (!savedIdPattern.test(id)) throw new Error("Invalid saved app version.");
  if (!(await assertPrivatePackage(user, token, true)))
    throw new Error("Saved app version not found.");
  const tag = `app-${id}`;
  const bearer = await registryBearer(user, token);
  const manifest = await registryManifest(user, bearer, tag);
  if (!savedAppFromManifest(manifest, user, tag))
    throw new Error("This is not a FlyHub saved app version.");
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const base = `https://api.github.com/user/packages/container/${savedAppPackage}/versions`;
  let match:
    { id: number; metadata?: { container?: { tags?: string[] } } } | undefined;
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${base}?per_page=100&page=${page}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Could not read GitHub package versions. Check read:packages permission.",
      );
    const versions = (await response.json()) as Array<{
      id: number;
      metadata?: { container?: { tags?: string[] } };
    }>;
    match = versions.find((version) =>
      version.metadata?.container?.tags?.includes(tag),
    );
    if (match || versions.length < 100) break;
  }
  if (!match || !Number.isSafeInteger(match.id) || match.id <= 0)
    throw new Error(
      "Saved version could not be matched to a GitHub package version. Refresh saved apps and try again.",
    );
  if (match.metadata?.container?.tags?.some((other) => other !== tag))
    throw new Error(
      "This image is shared by other tags. Manage it in GitHub to avoid deleting another saved version.",
    );
  const response = await fetch(`${base}/${match.id}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 403 || response.status === 401)
    throw new Error(
      "GitHub denied deletion. Update your GitHub connection with a classic token that has read:packages, write:packages, and delete:packages permissions, then retry.",
    );
  if (!response.ok && response.status !== 404)
    throw new Error(
      `Could not delete this saved version (GitHub HTTP ${response.status}).`,
    );
}
