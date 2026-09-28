/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Per-request auth for the Kody Operations Dashboard.
 *
 * Auth priority:
 * 1. Request headers from client (x-kody-token, x-kody-owner, x-kody-repo)
 * 2. Env vars only when a server-only caller opts in explicitly.
 *
 * There is no server-side session: the dashboard stores credentials in
 * localStorage after the user connects a repo, and every API call passes
 * them via the three custom headers above.
 */
import { NextRequest, NextResponse } from "next/server";
import { createUserOctokit } from "./github/core";
import { logger } from "@kody-ade/base/logger";
import type { Octokit } from "@octokit/rest";
import { KODY_AUTH_HEADERS } from "@kody-ade/base/auth-headers";

// ─── Header constants (must match auth-context.ts buildAuthHeaders) ─────────────

const HDR_TOKEN = KODY_AUTH_HEADERS.token;
const HDR_OWNER = KODY_AUTH_HEADERS.owner;
const HDR_REPO = KODY_AUTH_HEADERS.repo;
const HDR_USER_LOGIN = KODY_AUTH_HEADERS.userLogin;
const HDR_STORE_REPO_URL = KODY_AUTH_HEADERS.storeRepoUrl;
const HDR_STORE_REF = KODY_AUTH_HEADERS.storeRef;

// ─── Per-request auth from headers ────────────────────────────────────────────

export interface RequestAuth {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

export interface UserRequestAuth {
  token: string;
}

/** User authentication is independent from optional repository context. */
export function getUserRequestAuth(req: NextRequest): UserRequestAuth | null {
  const token = req.headers.get(HDR_TOKEN)?.trim();
  return token ? { token } : null;
}

/**
 * Extract auth from request headers (set by client from localStorage).
 * Returns null if headers are missing or incomplete.
 */
export function getRequestAuth(req: NextRequest): RequestAuth | null {
  const token = getUserRequestAuth(req)?.token;
  const owner = req.headers.get(HDR_OWNER);
  const repo = req.headers.get(HDR_REPO);
  const userLogin = req.headers.get(HDR_USER_LOGIN)?.trim() || undefined;
  const storeRepoUrl = req.headers.get(HDR_STORE_REPO_URL)?.trim() || undefined;
  const storeRef = req.headers.get(HDR_STORE_REF)?.trim() || undefined;

  if (!token || !owner || !repo) return null;
  return { token, owner, repo, userLogin, storeRepoUrl, storeRef };
}

// ─── Server-side env token (fallback for CI / token-only deployments) ────────

function getEnvToken(): string | null {
  return (
    process.env.KODY_BOT_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT ||
    null
  );
}

// ─── Require auth — 401 unless request auth is present ───────────────────────

export interface KodyAuthOptions {
  allowEnvToken?: boolean;
}

/**
 * Require auth for a route. Checks:
 * 1. x-kody-token header (client localStorage auth)
 * 2. KODY_BOT_TOKEN / GITHUB_TOKEN only when allowEnvToken is true
 *
 * Returns null on success, or a NextResponse on failure.
 */
export async function requireKodyAuth(
  req: NextRequest,
  options: KodyAuthOptions = {},
): Promise<null | NextResponse> {
  const headerAuth = getRequestAuth(req);
  const envToken = options.allowEnvToken ? getEnvToken() : null;

  if (!headerAuth && !envToken) {
    return NextResponse.json(
      {
        message:
          "Not authenticated. Provide x-kody-token, x-kody-owner, and x-kody-repo headers.",
      },
      { status: 401 },
    );
  }
  return null;
}

/** Require only a verified-user credential; repository context is optional. */
export async function requireUserAuth(
  req: NextRequest,
  options: KodyAuthOptions = {},
): Promise<null | NextResponse> {
  const headerAuth = getUserRequestAuth(req);
  const envToken = options.allowEnvToken ? getEnvToken() : null;
  if (!headerAuth && !envToken) {
    return NextResponse.json(
      { message: "Not authenticated. Provide an x-kody-token header." },
      { status: 401 },
    );
  }
  return null;
}

// ─── Get Octokit instance ──────────────────────────────────────────────────────

/**
 * Get a per-request Octokit instance.
 *
 * Priority:
 * 1. Client token from x-kody-token header (localStorage auth)
 * 2. Env token fallback only when allowEnvToken is true
 *
 * Callers should prefer the header token so operations are attributed
 * to the actual user rather than the bot account.
 */
export async function getUserOctokit(
  req: NextRequest,
  options: KodyAuthOptions = {},
): Promise<Octokit | null> {
  // 1. Client header token (localStorage auth)
  const headerAuth = getUserRequestAuth(req);
  if (headerAuth) {
    return createUserOctokit(headerAuth.token);
  }

  // 2. Env token fallback for explicit server-only callers
  const envToken = options.allowEnvToken ? getEnvToken() : null;
  if (envToken) {
    return createUserOctokit(envToken);
  }

  return null;
}

export type VerifiedRepoAccess = {
  auth: RequestAuth;
  actorLogin: string;
  actorGithubId: number;
  permission: string;
  octokit: Octokit;
};

const READ_REPOSITORY_PERMISSIONS = new Set([
  "pull",
  "read",
  "triage",
  "push",
  "write",
  "maintain",
  "admin",
]);
const WRITE_REPOSITORY_PERMISSIONS = new Set([
  "push",
  "write",
  "maintain",
  "admin",
]);

function repositoryPermission(permissions: {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
  triage?: boolean;
  pull?: boolean;
} | null | undefined): string {
  if (permissions?.admin) return "admin";
  if (permissions?.maintain) return "maintain";
  if (permissions?.push) return "push";
  if (permissions?.triage) return "triage";
  if (permissions?.pull) return "pull";
  return "none";
}

type GithubVerificationStage = "identity" | "permission";

function repositoryGithubErrorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return null;
}

function githubVerificationFailure(
  error: unknown,
  stage: GithubVerificationStage,
  auth: Pick<RequestAuth, "owner" | "repo">,
): NextResponse {
  const githubStatus = repositoryGithubErrorStatus(error);
  logger.warn(
    {
      event: `github_${stage}_verification_failed`,
      githubStatus,
      owner: auth.owner,
      repo: auth.repo,
    },
    "GitHub repository access verification failed",
  );

  if (githubStatus === 401) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  if (githubStatus === 403) {
    return NextResponse.json(
      { error: `github_${stage}_verification_forbidden` },
      { status: 403 },
    );
  }
  if (githubStatus === 404 && stage === "permission") {
    return NextResponse.json(
      { error: "repository_not_found_or_inaccessible" },
      { status: 404 },
    );
  }
  if (githubStatus === 429) {
    return NextResponse.json(
      { error: "github_rate_limited" },
      { status: 429 },
    );
  }
  if (githubStatus !== null && githubStatus >= 500) {
    return NextResponse.json(
      { error: "github_access_unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: `github_${stage}_verification_failed` },
    { status: 502 },
  );
}

async function verifyRepoAccess(
  req: NextRequest,
  allowedPermissions: ReadonlySet<string>,
  deniedError: string,
): Promise<VerifiedRepoAccess | NextResponse> {
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "request_auth_required" },
      { status: 401 },
    );
  }
  let actor: { login: string; id: number };
  try {
    const response = await octokit.rest.users.getAuthenticated();
    actor = response.data;
  } catch (error) {
    return githubVerificationFailure(error, "identity", auth);
  }

  try {
    const { data: repository } = await octokit.rest.repos.get({
      owner: auth.owner,
      repo: auth.repo,
    });
    const permission = repositoryPermission(repository.permissions);
    if (!allowedPermissions.has(permission)) {
      return NextResponse.json({ error: deniedError }, { status: 403 });
    }
    return {
      auth,
      actorLogin: actor.login,
      actorGithubId: actor.id,
      permission,
      octokit,
    };
  } catch (error) {
    return githubVerificationFailure(error, "permission", auth);
  }
}

export function verifyRepoReadAccess(
  req: NextRequest,
): Promise<VerifiedRepoAccess | NextResponse> {
  return verifyRepoAccess(
    req,
    READ_REPOSITORY_PERMISSIONS,
    "read_permission_required",
  );
}

export function verifyRepoWriteAccess(
  req: NextRequest,
): Promise<VerifiedRepoAccess | NextResponse> {
  return verifyRepoAccess(
    req,
    WRITE_REPOSITORY_PERMISSIONS,
    "write_permission_required",
  );
}

// ─── Verified actor identity (resolve the PAT → its GitHub user) ──────────────

export interface ActorIdentity {
  login: string;
  githubId: number;
  avatarUrl: string;
}

/**
 * Cache resolved identities so audit writes don't spend a `GET /user` call
 * per action. Keyed by a sha256 of the token (never the raw token), so the
 * map can't leak credentials if dumped. Long TTL — a PAT's owner is stable.
 */
const ACTOR_TTL_MS = 60 * 60 * 1000; // 1h
const ACTOR_RESOLUTION_ATTEMPTS = 3;
const ACTOR_RETRY_DELAY_MS = 150;
const actorCache = new Map<string, { identity: ActorIdentity; at: number }>();

type ActorResolution =
  | { kind: "resolved"; identity: ActorIdentity }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/**
 * Non-crypto fingerprint (djb2) so the cache never keys on a raw token. Not
 * security-grade — just avoids holding full credentials as Map keys, and
 * keeps this module free of `node:crypto` (auth.ts is reachable from client
 * bundles, where the `node:` scheme isn't resolvable).
 */
function tokenKey(token: string): string {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33) ^ token.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Resolve the GitHub user that owns a PAT via `GET /user` (cached). This is
 * the ONLY trustworthy actor signal the dashboard has — there is no server
 * session, and the client-supplied `actorLogin` is unverified. Audit writes
 * should attribute to this, not to whatever login the browser claimed.
 *
 * Returns null on any failure (bad token, network) — callers fall back to a
 * coarse actor rather than blocking the action being logged.
 */
function githubErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  return typeof error.status === "number" ? error.status : null;
}

function isTemporaryGithubError(error: unknown): boolean {
  const status = githubErrorStatus(error);
  return status === null || status === 429 || status >= 500;
}

async function resolveActorIdentity(token: string): Promise<ActorResolution> {
  const key = tokenKey(token);
  const hit = actorCache.get(key);
  if (hit && Date.now() - hit.at < ACTOR_TTL_MS) {
    return { kind: "resolved", identity: hit.identity };
  }

  const octokit = createUserOctokit(token);
  for (let attempt = 1; attempt <= ACTOR_RESOLUTION_ATTEMPTS; attempt += 1) {
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      const identity: ActorIdentity = {
        login: data.login,
        githubId: data.id,
        avatarUrl: data.avatar_url,
      };
      actorCache.set(key, { identity, at: Date.now() });
      return { kind: "resolved", identity };
    } catch (error) {
      if (!isTemporaryGithubError(error)) {
        logger.warn({ error }, "resolveActorFromToken: invalid GitHub token");
        return { kind: "invalid" };
      }
      if (attempt === ACTOR_RESOLUTION_ATTEMPTS) {
        logger.warn({ error }, "resolveActorFromToken: GitHub unavailable");
        return { kind: "unavailable" };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, ACTOR_RETRY_DELAY_MS * attempt),
      );
    }
  }
  return { kind: "unavailable" };
}

export async function resolveActorFromToken(
  token: string,
): Promise<ActorIdentity | null> {
  const result = await resolveActorIdentity(token);
  return result.kind === "resolved" ? result.identity : null;
}

// ─── Actor login verification ───────────────────────────────────────────────────

/**
 * Verify that the supplied actorLogin matches the authenticated request.
 *
 * The PAT and its scopes are the authority. Resolve the token owner through
 * GitHub, then reject any caller-supplied actorLogin that does not match.
 */
export async function verifyActorLogin(
  req: NextRequest,
  suppliedLogin: string | undefined,
): Promise<
  | { identity: { login: string; avatar_url: string; githubId: number } }
  | NextResponse
> {
  const headerAuth = getUserRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      {
        error: "request_auth_required",
        message: "Actor verification requires an x-kody-token header.",
      },
      { status: 401 },
    );
  }

  const resolution = await resolveActorIdentity(headerAuth.token);
  if (resolution.kind === "unavailable") {
    return NextResponse.json(
      {
        error: "github_identity_unavailable",
        message: "GitHub is temporarily unavailable. Try again shortly.",
      },
      { status: 503 },
    );
  }
  if (resolution.kind === "invalid") {
    return NextResponse.json(
      { error: "invalid_token", message: "Unable to verify GitHub identity." },
      { status: 401 },
    );
  }
  const resolved = resolution.identity;

  if (suppliedLogin && suppliedLogin !== resolved.login) {
    logger.warn(
      {
        suppliedLogin,
        resolvedLogin: resolved.login,
        path: req.nextUrl.pathname,
      },
      "Actor login mismatch",
    );
    return NextResponse.json(
      { error: "actor_mismatch", message: "Actor does not match token owner." },
      { status: 403 },
    );
  }

  return {
    identity: {
      login: resolved.login,
      avatar_url: resolved.avatarUrl,
      githubId: resolved.githubId,
    },
  };
}
