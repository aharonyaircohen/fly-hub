const ENDPOINT = "/api/kody/account/repositories";
const PENDING_BROWSER_AUTH_KEY = "kody_pending_repository_import";

export type AccountRepositoryLoadResult =
  | { status: "loaded"; auth: unknown | null }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export async function loadAccountRepositoryAuth(): Promise<AccountRepositoryLoadResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { cache: "no-store" });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "unauthenticated" };
  }
  if (!response.ok) return { status: "unavailable" };
  const payload = (await response.json().catch(() => null)) as {
    auth?: unknown;
  } | null;
  return { status: "loaded", auth: payload?.auth ?? null };
}

export async function saveAccountRepositoryAuth(
  auth: unknown,
): Promise<boolean> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearAccountRepositoryAuth(): Promise<void> {
  await fetch(ENDPOINT, { method: "DELETE" }).catch(() => undefined);
}

export function savePendingBrowserRepositoryAuth(auth: unknown): void {
  localStorage.setItem(PENDING_BROWSER_AUTH_KEY, JSON.stringify(auth));
}

export function loadPendingBrowserRepositoryAuth(): unknown | null {
  const stored = localStorage.getItem(PENDING_BROWSER_AUTH_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem(PENDING_BROWSER_AUTH_KEY);
    return null;
  }
}

export function clearPendingBrowserRepositoryAuth(): void {
  localStorage.removeItem(PENDING_BROWSER_AUTH_KEY);
}
