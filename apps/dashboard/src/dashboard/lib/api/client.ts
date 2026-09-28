/**
 * @fileType utility
 * @domain kody
 * @pattern api-client
 * @ai-summary Core transport for the Kody dashboard API client — auth
 * headers, error types, and response handling. No feature imports.
 */

import { buildKodyAuthHeaders } from "@kody-ade/base/auth-headers";
import { readActiveRepo, readStoredKodyAuth } from "@kody-ade/base/active-repo";

export const API_BASE = "/api/kody";

// ============ Auth Headers ============

export function getStoredAuth(): {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
  storeRepoUrl?: string;
  storeRef?: string;
} | null {
  const blob = readStoredKodyAuth();
  if (!blob) return null;
  // URL-first: the active repo (and its per-repo PAT) comes from the route,
  // not from the stored flat fields — see active-repo.ts.
  const active = readActiveRepo();
  const auth = blob as {
    token?: string;
    user?: { login?: string };
    storeRepoUrl?: string;
    storeRepo?: string;
    storeRef?: string;
  };
  const token = active?.token || auth.token?.trim();
  if (!token) return null;
  return {
    token,
    owner: active?.owner ?? "",
    repo: active?.repo ?? "",
    userLogin: auth.user?.login,
    storeRepoUrl:
      auth.storeRepoUrl ??
      (auth.storeRepo ? `https://github.com/${auth.storeRepo}` : undefined),
    storeRef: auth.storeRef,
  };
}

/**
 * Read the user-scoped Fly performance tier. Returns null when unset; the
 * server then falls back to the documented default ("medium" =
 * performance-1x). Sent as the `x-kody-fly-perf` header on start-fly calls.
 */
export function getStoredFlyPerf(): "low" | "medium" | "high" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { flyPerf?: string };
    if (
      parsed.flyPerf === "low" ||
      parsed.flyPerf === "medium" ||
      parsed.flyPerf === "high"
    ) {
      return parsed.flyPerf;
    }
    return null;
  } catch {
    return null;
  }
}

export function getStoredBrainTerminalActivityLimit(): number | "never" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      brainTerminalActivityLimit?: unknown;
    };
    const value = parsed.brainTerminalActivityLimit;
    if (value === "never") return "never";
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function getStoredBrainSuspension(): "auto" | "never" {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return "auto";
    const parsed = JSON.parse(raw) as {
      brainSuspension?: unknown;
      brainTerminalActivityLimit?: unknown;
    };
    if (parsed.brainSuspension === "never") return "never";
    if (parsed.brainSuspension === "auto") return "auto";
    return parsed.brainTerminalActivityLimit === "never" ? "never" : "auto";
  } catch {
    return "auto";
  }
}

/**
 * Read optional Brain assistant config stored at login. Returns null unless
 * both `url` and `apiKey` are present — partial config is treated as missing.
 */
export function getStoredBrainConfig(): { url: string; apiKey: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      brain?: { url?: string; apiKey?: string };
    };
    const b = parsed.brain;
    if (!b?.url || !b.apiKey) return null;
    return { url: b.url, apiKey: b.apiKey };
  } catch {
    return null;
  }
}

export interface ApiAuthContext {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

export function buildHeaders(
  extra: Record<string, string> = {},
  authOverride?: ApiAuthContext | null,
): Record<string, string> {
  const auth = authOverride === undefined ? getStoredAuth() : authOverride;
  return {
    "Content-Type": "application/json",
    ...buildKodyAuthHeaders(auth),
    ...extra,
  };
}

// ============ Error Types ============

export class RateLimitError extends Error {
  retryAfter: string | null;
  resetTime: string | null;

  constructor(message: string, retryAfter?: string, resetTime?: string) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter ?? null;
    this.resetTime = resetTime ?? null;
  }
}

export class NoTokenError extends Error {
  constructor(message = "GitHub token is not configured. Please log in.") {
    super(message);
    this.name = "NoTokenError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "Your session has expired. Please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/**
 * Drop stored credentials and bounce to the dashboard root. The root
 * route's AuthGuard then renders the `<RepoManager />` empty-state so the
 * user can re-connect a repo. There is no separate `/login` page anymore.
 *
 * `returnTo` is kept for call-site compatibility but is unused — we always
 * land on `/`, since most callers were only redirecting to clear stale auth.
 */
export function redirectToLogin(_returnTo = "/"): void {
  void _returnTo;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("kody_auth");
    } catch {
      // ignore — SSR or storage disabled
    }
    window.location.href = "/";
  }
}

// ============ Helpers ============

export async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();

  if (res.status === 429) {
    throw new RateLimitError(
      data.message || "Rate limited",
      data.retryAfter ?? undefined,
      data.resetTime ?? undefined,
    );
  }

  if (res.status === 401) {
    // Token-based auth: all 401s mean the user needs to log in again.
    throw new SessionExpiredError(
      data.message || "Your session has expired. Please log in again.",
    );
  }

  if (!res.ok) {
    throw new ApiError(
      data.message || data.error || "Request failed",
      res.status,
      data,
    );
  }

  return data as T;
}
