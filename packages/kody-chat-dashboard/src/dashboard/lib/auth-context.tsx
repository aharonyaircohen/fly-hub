/**
 * @fileType context
 * @domain kody
 *
 * Auth context for reading stored GitHub credentials from localStorage.
 *
 * Multi-repo: stores a list of repos under `repos[]`. The *active* repo is
 * derived from the URL (`/repo/<owner>/<repo>/…` — see active-repo.ts), NOT
 * from stored state; the flat fields (owner/repo/token/repoUrl) and
 * `currentRepoIndex` exposed on `auth` are computed from the pathname each
 * render. The flat fields are still persisted as a mirror, but only as the
 * fallback for repo-less pages (/, /org, /settings) and for the brand
 * cookie — the URL always wins. Switching repos is a full-page navigation
 * to the target repo's URL (clears React Query cache and in-flight polls).
 *
 * On login: credentials stored in localStorage as JSON.
 * On logout: credentials cleared from localStorage.
 *
 * API routes read the token from a custom header set by the client
 * (x-kody-token, x-kody-owner, x-kody-repo) instead of env vars.
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { usePathname } from "next/navigation";
import { resolveActiveRepo, type ActiveRepo } from "@kody-ade/base/active-repo";
import { repoBasePath } from "@kody-ade/base/routes";
import {
  DEFAULT_KODY_STORE_REF,
  DEFAULT_KODY_STORE_REPO_URL,
  buildKodyAuthHeaders,
} from "@kody-ade/base/auth-headers";
import {
  CLIENT_BRAND_REPO_COOKIE,
  serializeClientBrandRepoCookie,
} from "./client-brand-repo-cookie";
import {
  clearAccountRepositoryAuth,
  loadAccountRepositoryAuth,
  savePendingBrowserRepositoryAuth,
  saveAccountRepositoryAuth,
} from "./account-repository-persistence";

export { DEFAULT_KODY_STORE_REF, DEFAULT_KODY_STORE_REPO_URL };

export interface KodyUser {
  login: string;
  avatar_url: string;
  id: number;
}

export interface KodyRepoEntry {
  /** Original `https://github.com/owner/repo` URL the user pasted (optional). */
  repoUrl: string;
  owner: string;
  repo: string;
  /** GitHub PAT scoped to this repo. */
  token: string;
  /** Unix-ms when this repo was added. */
  addedAt: number;
  /** Legacy marker for the repository first used during GitHub setup. */
  isLogin: boolean;
  /** GitHub identity verified from this repository's token. */
  user?: KodyUser;
}

export type RepositoryAddInput = Omit<
  KodyRepoEntry,
  "addedAt" | "isLogin" | "user"
>;

export interface KodyAuth {
  // ─── Flat fields — always reflect the *current* repo (backward compat) ─
  repoUrl: string;
  owner: string;
  repo: string;
  token: string;
  user: KodyUser;
  loggedInAt: number;
  // ─── Multi-repo state ──────────────────────────────────────────────────
  repos: KodyRepoEntry[];
  currentRepoIndex: number;
  // ─── Optional integrations (per-browser) ───────────────────────────────
  brain?: { url: string; apiKey: string };
  vercelBypassSecret?: string;
  /**
   * Fly VM performance tier for kody-live-fly spawns. Sent as the
   * `x-kody-fly-perf` header; the server picks the matching guest config:
   *   low    → shared-cpu-2x / 2GB  (chat-only, ~$0.005/30min session)
   *   medium → performance-1x / 2GB (vibe coding, ~$0.05/30min) — default
   *   high   → performance-2x / 4GB (heavy installs/tests, ~$0.11/30min)
   */
  flyPerf?: "low" | "medium" | "high";
  /**
   * Fly VM performance tier for the per-user Brain server, INDEPENDENT of
   * `flyPerf` (task runs). Sent as `x-kody-brain-perf` on provision; same
   * guest mapping as flyPerf. Absent → server default (medium).
   */
  brainPerf?: "low" | "medium" | "high";
  /**
   * Brain Fly auto-suspension policy. Absent = auto-suspend when idle.
   */
  brainSuspension?: BrainSuspensionMode;
  /** Legacy browser key from the previous terminal-activity UI. */
  brainTerminalActivityLimit?: BrainTerminalActivityLimit;
  /** Shared Kody Store repository URL used for company-level capabilities. */
  storeRepoUrl?: string;
  /** Shared Kody Store ref used for company-level capabilities. */
  storeRef?: string;
}

export function activeRepoSelectionMatchesAuth(
  active: ActiveRepo,
  auth: KodyAuth,
): boolean {
  return (
    active.index === auth.currentRepoIndex &&
    active.owner === auth.owner &&
    active.repo === auth.repo &&
    active.token === auth.token &&
    (active.user?.login ?? auth.user.login) === auth.user.login
  );
}

export type FlyPerfTier = NonNullable<KodyAuth["flyPerf"]>;
export type BrainTerminalActivityLimit = number | "never";
export type BrainSuspensionMode = "auto" | "never";

export interface AuthContextValue {
  auth: KodyAuth | null;
  loading: boolean;
  logout: () => void;
  /** Start a private user session before any repository is attached. */
  signIn: (token: string, user: KodyUser) => void;
  /**
   * Push a new repo entry. When auth is null this *bootstraps* the auth
   * object — the caller must supply `user` (basic GitHub identity for the
   * supplied token). For subsequent adds `user` is ignored.
   * Does not switch to the new repo unless it's the bootstrap one.
   */
  addRepo: (
    entry: RepositoryAddInput,
    user?: KodyAuth["user"],
  ) => Promise<boolean>;
  /** Replace one repository's verified browser-owned PAT and identity. */
  replaceRepoToken: (index: number, token: string, user: KodyUser) => boolean;
  /** Remove a repo by index. Removing the final repo leaves the account signed in. */
  removeRepo: (index: number) => void;
  /** Switch the active repo. Triggers a full page reload to clear React Query cache. */
  setCurrentRepo: (
    index: number,
    options?: { redirectTo?: string; navigateBeforeCommit?: boolean },
  ) => void;
  /**
   * Update the per-browser integration fields (brain, vercelBypassSecret).
   * Pass `null` to clear a field, omit it to leave it unchanged.
   */
  updateIntegrations: (patch: {
    brain?: { url: string; apiKey: string } | null;
    vercelBypassSecret?: string | null;
    flyPerf?: FlyPerfTier | null;
    brainPerf?: FlyPerfTier | null;
    brainSuspension?: BrainSuspensionMode | null;
    brainTerminalActivityLimit?: BrainTerminalActivityLimit | null;
    storeRepoUrl?: string | null;
    storeRef?: string | null;
  }) => void;
}

const AuthContext = createContext<AuthContextValue>({
  auth: null,
  loading: true,
  logout: () => {},
  signIn: () => {},
  addRepo: async () => false,
  replaceRepoToken: () => false,
  removeRepo: () => {},
  setCurrentRepo: () => {},
  updateIntegrations: () => {},
});

export function repositoryAuthAfterRemoval(
  auth: KodyAuth,
  index: number,
): KodyAuth | null {
  if (index < 0 || index >= auth.repos.length) return auth;
  const repos = auth.repos.filter((_, repoIndex) => repoIndex !== index);
  if (repos.length === 0) return null;
  const currentRepoIndex =
    index === auth.currentRepoIndex
      ? 0
      : index < auth.currentRepoIndex
        ? auth.currentRepoIndex - 1
        : auth.currentRepoIndex;
  const current = repos[currentRepoIndex]!;
  return {
    ...auth,
    repos,
    currentRepoIndex,
    repoUrl: current.repoUrl,
    owner: current.owner,
    repo: current.repo,
    token: current.token,
    user: current.user ?? auth.user,
  };
}

export function repositoryAuthAfterAdd(
  auth: KodyAuth | null,
  entry: RepositoryAddInput,
  user: KodyUser | undefined,
  addedAt = Date.now(),
): KodyAuth | null {
  const owner = typeof entry?.owner === "string" ? entry.owner.trim() : "";
  const repo = typeof entry?.repo === "string" ? entry.repo.trim() : "";
  const token = typeof entry?.token === "string" ? entry.token.trim() : "";
  if (!owner || !repo || !token || !user) return null;

  const nextEntry: KodyRepoEntry = {
    ...entry,
    repoUrl: entry.repoUrl || `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    token,
    user,
    addedAt,
    isLogin: !auth || auth.repos.length === 0,
  };

  if (!auth || auth.repos.length === 0) {
    return {
      ...auth,
      repoUrl: nextEntry.repoUrl,
      owner,
      repo,
      token,
      user,
      loggedInAt: auth?.loggedInAt ?? addedAt,
      repos: [nextEntry],
      currentRepoIndex: 0,
    };
  }

  const existingIndex = auth.repos.findIndex(
    (candidate) =>
      candidate.owner.toLowerCase() === owner.toLowerCase() &&
      candidate.repo.toLowerCase() === repo.toLowerCase(),
  );
  const repos =
    existingIndex >= 0
      ? auth.repos.map((candidate, index) =>
          index === existingIndex
            ? { ...candidate, ...nextEntry, isLogin: candidate.isLogin }
            : candidate,
        )
      : [...auth.repos, nextEntry];
  return { ...auth, repos };
}

/**
 * Migrate legacy single-repo auth (no `repos[]`) into the multi-repo shape.
 * Pure function — no localStorage writes.
 */
function migrateAuth(raw: unknown): KodyAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<KodyAuth> & {
    repos?: KodyRepoEntry[];
    currentRepoIndex?: number;
    storeRepo?: string;
  };

  if (!a.token || !a.user) return null;

  if (!a.owner || !a.repo) {
    return {
      ...(a as KodyAuth),
      repoUrl: "",
      owner: "",
      repo: "",
      token: a.token,
      user: a.user,
      loggedInAt: a.loggedInAt ?? Date.now(),
      repos: [],
      currentRepoIndex: -1,
    };
  }

  // Already migrated.
  if (
    Array.isArray(a.repos) &&
    a.repos.length > 0 &&
    typeof a.currentRepoIndex === "number"
  ) {
    const repos = a.repos.map((repo) =>
      repo.isLogin && !repo.user ? { ...repo, user: a.user } : repo,
    );
    const idx = Math.min(Math.max(0, a.currentRepoIndex), repos.length - 1);
    const cur = repos[idx];
    // Trust repos[idx] as source of truth — repaint flat fields if drifted.
    const brainSuspension =
      a.brainSuspension === "auto" || a.brainSuspension === "never"
        ? a.brainSuspension
        : a.brainTerminalActivityLimit === "never"
          ? "never"
          : undefined;
    return {
      ...(a as KodyAuth),
      currentRepoIndex: idx,
      repoUrl: cur.repoUrl,
      owner: cur.owner,
      repo: cur.repo,
      token: cur.token,
      user: cur.user ?? a.user,
      repos,
      brainSuspension,
      brainTerminalActivityLimit: undefined,
      storeRepoUrl:
        a.storeRepoUrl ??
        (typeof a.storeRepo === "string" && a.storeRepo
          ? `https://github.com/${a.storeRepo}`
          : undefined),
    };
  }

  // Legacy: build single-entry repos[].
  const loginEntry: KodyRepoEntry = {
    repoUrl: a.repoUrl ?? `https://github.com/${a.owner}/${a.repo}`,
    owner: a.owner,
    repo: a.repo,
    token: a.token,
    addedAt: a.loggedInAt ?? Date.now(),
    isLogin: true,
    user: a.user,
  };

  return {
    repoUrl: loginEntry.repoUrl,
    owner: loginEntry.owner,
    repo: loginEntry.repo,
    token: loginEntry.token,
    user: a.user,
    loggedInAt: a.loggedInAt ?? Date.now(),
    repos: [loginEntry],
    currentRepoIndex: 0,
    brain: a.brain,
    vercelBypassSecret: a.vercelBypassSecret,
    flyPerf: a.flyPerf,
    brainPerf: a.brainPerf,
    brainSuspension:
      a.brainSuspension === "auto" || a.brainSuspension === "never"
        ? a.brainSuspension
        : a.brainTerminalActivityLimit === "never"
          ? "never"
          : undefined,
    storeRepoUrl:
      a.storeRepoUrl ??
      (typeof a.storeRepo === "string" && a.storeRepo
        ? `https://github.com/${a.storeRepo}`
        : undefined),
    storeRef: a.storeRef,
  };
}

function persistBrowser(next: KodyAuth): void {
  localStorage.setItem("kody_auth", JSON.stringify(next));
  syncClientBrandRepoCookie(next);
}

function syncClientBrandRepoCookie(auth: KodyAuth): void {
  if (!auth.owner || !auth.repo) {
    clearClientBrandRepoCookie();
    return;
  }
  document.cookie = `${CLIENT_BRAND_REPO_COOKIE}=${serializeClientBrandRepoCookie(
    {
      owner: auth.owner,
      repo: auth.repo,
      ...(auth.storeRepoUrl ? { storeRepoUrl: auth.storeRepoUrl } : {}),
      ...(auth.storeRef ? { storeRef: auth.storeRef } : {}),
    },
  )}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

function clearClientBrandRepoCookie(): void {
  document.cookie = `${CLIENT_BRAND_REPO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function clearBrowserRepositorySession(): void {
  localStorage.removeItem("kody_auth");
  clearClientBrandRepoCookie();
}

export async function refreshRepoIdentity(
  auth: KodyAuth,
  pathname: string,
): Promise<KodyAuth> {
  const active = resolveActiveRepo(auth, pathname);
  if (!active) return auth;
  if (active.user) {
    return active.user.login === auth.user.login
      ? auth
      : { ...auth, user: active.user };
  }

  try {
    const res = await fetch("/api/kody/auth/me", {
      headers: buildKodyAuthHeaders(active),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as {
      authenticated?: boolean;
      user?: { login?: string; avatar_url?: string; githubId?: number };
    } | null;
    if (
      !res.ok ||
      !data?.authenticated ||
      !data.user?.login ||
      !data.user.avatar_url ||
      typeof data.user.githubId !== "number"
    ) {
      return auth;
    }

    const user: KodyUser = {
      login: data.user.login,
      avatar_url: data.user.avatar_url,
      id: data.user.githubId,
    };
    const repos = auth.repos.map((repo, index) =>
      index === active.index ? { ...repo, user } : repo,
    );
    return { ...auth, repos, user };
  } catch {
    // Keep the existing state. Sensitive writes still reject any mismatch.
    return auth;
  }
}

export function AuthProvider({
  children,
  persistence = "browser",
}: {
  children: React.ReactNode;
  persistence?: "browser" | "account";
}) {
  const [storedAuth, setStoredAuth] = useState<KodyAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const persistAuth = useCallback(
    (next: KodyAuth) => {
      persistBrowser(next);
      if (persistence === "account") {
        void saveAccountRepositoryAuth(next);
      }
    },
    [persistence],
  );

  // The URL is the source of truth for the active repo: derive the flat
  // fields + currentRepoIndex from the pathname every render. The stored
  // flat fields only act as the fallback on repo-less pages.
  const auth = useMemo(() => {
    if (!storedAuth) return null;
    const active = resolveActiveRepo(storedAuth, pathname);
    if (!active) return storedAuth;
    if (activeRepoSelectionMatchesAuth(active, storedAuth)) {
      return storedAuth;
    }
    return {
      ...storedAuth,
      currentRepoIndex: active.index,
      repoUrl: active.repoUrl,
      owner: active.owner,
      repo: active.repo,
      token: active.token,
      user: active.user ?? storedAuth.user,
    };
  }, [storedAuth, pathname]);

  // Mirror the URL-derived selection back to localStorage so repo-less
  // pages and the brand cookie follow the last visited repo. The URL still
  // wins on every read — this is a fallback hint, never a competing truth.
  useEffect(() => {
    if (!auth || auth === storedAuth) return;
    persistAuth(auth);
    setStoredAuth(auth);
  }, [auth, persistAuth, storedAuth]);

  // Load auth from localStorage on mount, migrating legacy shape if needed.
  useEffect(() => {
    let cancelled = false;
    async function loadAuth() {
      try {
        if (persistence === "account") {
          let browserAuth: KodyAuth | null = null;
          try {
            browserAuth = migrateAuth(
              JSON.parse(localStorage.getItem("kody_auth") ?? "null"),
            );
          } catch {
            // Ignore malformed legacy browser state; account state still loads.
          }
          clearBrowserRepositorySession();
          const accountResult = await loadAccountRepositoryAuth();
          const migrated =
            accountResult.status === "loaded"
              ? migrateAuth(accountResult.auth)
              : accountResult.status === "unauthenticated"
                ? browserAuth
                : null;
          if (cancelled) return;
          if (migrated) {
            const refreshed = await refreshRepoIdentity(
              migrated,
              window.location.pathname,
            );
            if (cancelled) return;
            setStoredAuth(refreshed);
            persistBrowser(refreshed);
          } else {
            if (accountResult.status === "loaded" && browserAuth) {
              savePendingBrowserRepositoryAuth(browserAuth);
            }
            setStoredAuth(null);
          }
          return;
        }
        const stored = localStorage.getItem("kody_auth");
        if (stored) {
          const parsed = JSON.parse(stored);
          const migrated = migrateAuth(parsed);
          if (migrated) {
            const refreshed = await refreshRepoIdentity(
              migrated,
              window.location.pathname,
            );
            if (cancelled) return;
            // Persist migration result so subsequent loads skip the legacy branch.
            setStoredAuth(refreshed);
            persistBrowser(refreshed);
          } else {
            localStorage.removeItem("kody_auth");
          }
        }
      } catch {
        // Corrupted localStorage — clear it
        localStorage.removeItem("kody_auth");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  const logout = useCallback(() => {
    void fetch("/api/kody/auth/me", { method: "DELETE" }).finally(() => {
      if (persistence === "account") {
        void clearAccountRepositoryAuth();
      }
      clearBrowserRepositorySession();
      setStoredAuth(null);
      window.location.href = "/";
    });
  }, [persistence]);

  const signIn = useCallback(
    (token: string, user: KodyUser) => {
      const next: KodyAuth = {
        repoUrl: "",
        owner: "",
        repo: "",
        token: token.trim(),
        user,
        loggedInAt: Date.now(),
        repos: [],
        currentRepoIndex: -1,
      };
      persistAuth(next);
      setStoredAuth(next);
    },
    [persistAuth],
  );

  const addRepo = useCallback(
    async (entry: RepositoryAddInput, user?: KodyAuth["user"]) => {
      const next = repositoryAuthAfterAdd(auth, entry, user);
      if (!next) return false;

      if (persistence === "account") {
        const saved = await saveAccountRepositoryAuth(next);
        if (!saved) return false;
      }
      persistBrowser(next);
      setStoredAuth(next);
      return true;
    },
    [auth, persistence],
  );

  const removeRepo = useCallback(
    (index: number) => {
      setStoredAuth((prev) => {
        if (!prev) return prev;
        const next = repositoryAuthAfterRemoval(prev, index);
        if (next === prev) return prev;
        if (!next) {
          if (persistence === "account") {
            void clearAccountRepositoryAuth();
          }
          localStorage.removeItem("kody_auth");
          clearClientBrandRepoCookie();
          window.location.assign("/chat");
          return null;
        }
        persistAuth(next);
        // Removing the active repo: its URL is now dead — do a full-page
        // navigation to the fallback repo's home (also clears caches).
        if (index === prev.currentRepoIndex) {
          window.location.assign(repoBasePath(next));
        }
        return next;
      });
    },
    [persistAuth, persistence],
  );

  const replaceRepoToken = useCallback(
    (index: number, token: string, user: KodyUser): boolean => {
      const trimmedToken = token.trim();
      if (!auth || !trimmedToken || index < 0 || index >= auth.repos.length) {
        return false;
      }

      const repos = auth.repos.map((repo, repoIndex) =>
        repoIndex === index ? { ...repo, token: trimmedToken, user } : repo,
      );
      const replacingActive = index === auth.currentRepoIndex;
      const next: KodyAuth = {
        ...auth,
        repos,
        ...(replacingActive ? { token: trimmedToken, user } : {}),
      };
      persistAuth(next);
      setStoredAuth(next);
      return true;
    },
    [auth, persistAuth],
  );

  const setCurrentRepo = useCallback(
    (
      index: number,
      options?: { redirectTo?: string; navigateBeforeCommit?: boolean },
    ) => {
      if (!auth) return;
      if (index < 0 || index >= auth.repos.length) return;
      if (index === auth.currentRepoIndex) return;
      const cur = auth.repos[index];
      const next: KodyAuth = {
        ...auth,
        currentRepoIndex: index,
        repoUrl: cur.repoUrl,
        owner: cur.owner,
        repo: cur.repo,
        token: cur.token,
        user: cur.user ?? auth.user,
      };
      // The URL carries the repo from here on — persist only refreshes the
      // repo-less-page fallback and the brand cookie, then a full-page
      // navigation to the target repo's URL wipes React Query cache,
      // in-flight polls, and chat state.
      persistAuth(next);
      window.location.assign(options?.redirectTo ?? repoBasePath(cur));
    },
    [auth, persistAuth],
  );

  const updateIntegrations = useCallback(
    (patch: {
      brain?: { url: string; apiKey: string } | null;
      vercelBypassSecret?: string | null;
      flyPerf?: FlyPerfTier | null;
      brainPerf?: FlyPerfTier | null;
      brainSuspension?: BrainSuspensionMode | null;
      brainTerminalActivityLimit?: BrainTerminalActivityLimit | null;
      storeRepoUrl?: string | null;
      storeRef?: string | null;
    }) => {
      setStoredAuth((prev) => {
        if (!prev) return prev;
        const next: KodyAuth = { ...prev };
        if (patch.brain !== undefined) {
          next.brain = patch.brain === null ? undefined : patch.brain;
        }
        if (patch.vercelBypassSecret !== undefined) {
          next.vercelBypassSecret =
            patch.vercelBypassSecret === null
              ? undefined
              : patch.vercelBypassSecret;
        }
        if (patch.flyPerf !== undefined) {
          next.flyPerf = patch.flyPerf === null ? undefined : patch.flyPerf;
        }
        if (patch.brainPerf !== undefined) {
          next.brainPerf =
            patch.brainPerf === null ? undefined : patch.brainPerf;
        }
        if (patch.brainSuspension !== undefined) {
          next.brainSuspension =
            patch.brainSuspension === null ? undefined : patch.brainSuspension;
          next.brainTerminalActivityLimit = undefined;
        }
        if (patch.brainTerminalActivityLimit !== undefined) {
          next.brainTerminalActivityLimit =
            patch.brainTerminalActivityLimit === null
              ? undefined
              : patch.brainTerminalActivityLimit;
        }
        if (patch.storeRepoUrl !== undefined) {
          const storeRepoUrl = patch.storeRepoUrl?.trim();
          next.storeRepoUrl = storeRepoUrl ? storeRepoUrl : undefined;
        }
        if (patch.storeRef !== undefined) {
          const storeRef = patch.storeRef?.trim();
          next.storeRef = storeRef ? storeRef : undefined;
        }
        persistAuth(next);
        return next;
      });
    },
    [persistAuth],
  );

  return (
    <AuthContext.Provider
      value={{
        auth,
        loading,
        logout,
        signIn,
        addRepo,
        replaceRepoToken,
        removeRepo,
        setCurrentRepo,
        updateIntegrations,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Lets an embedding host provide its existing auth state to Kody Chat.
 * This avoids a second provider reading the same credentials into a separate
 * React context, while keeping the package independent from the host app.
 */
export function KodyAuthBridgeProvider({
  value,
  children,
}: {
  value: AuthContextValue;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Build authorization headers from localStorage auth.
 * Use this in API route client-side calls.
 */
export function buildAuthHeaders(
  auth: KodyAuth | null,
): Record<string, string> {
  return buildKodyAuthHeaders(auth);
}
