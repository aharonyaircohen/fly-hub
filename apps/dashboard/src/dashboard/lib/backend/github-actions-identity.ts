import { createRemoteJWKSet, jwtVerify } from "jose";

const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
const KODY_ENGINE_AUDIENCE = "kody-api";
const GITHUB_ACTIONS_JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

export interface GitHubWorkflowIdentity {
  repository: string;
  workflowRef: string;
  actor: string | null;
  runId: string | null;
}

function optionalNumericClaim(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return null;
}

type VerifyJwt = typeof jwtVerify;

function requiredClaim(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`GitHub identity is missing ${name}`);
  }
  return value.trim();
}

export async function verifyGitHubWorkflowIdentity(
  token: string,
  verify: VerifyJwt = jwtVerify,
): Promise<GitHubWorkflowIdentity> {
  const { payload } = await verify(token, GITHUB_ACTIONS_JWKS, {
    issuer: GITHUB_ACTIONS_ISSUER,
    audience: KODY_ENGINE_AUDIENCE,
  });

  const repository = requiredClaim(payload, "repository");
  const workflowRef = requiredClaim(payload, "workflow_ref");
  const expectedPrefix = `${repository}/.github/workflows/kody.yml@`;
  if (!workflowRef.startsWith(expectedPrefix)) {
    throw new Error("GitHub identity was not issued for the Kody workflow");
  }

  return {
    repository,
    workflowRef,
    actor: typeof payload.actor === "string" ? payload.actor : null,
    runId: optionalNumericClaim(payload.run_id),
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}
