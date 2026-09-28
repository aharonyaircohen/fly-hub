import { createHash } from "node:crypto";
import { resolveActorFromToken } from "@kody-ade/base/auth";
import { KODY_AUTH_HEADERS } from "@kody-ade/base/auth-headers";

import type { EngineRuntimeModelConfig } from "@kody-ade/base/variables/models";
import type { ProviderPerfTier } from "@kody-ade/fly/infrastructure/server-operations";
import { getPersonalBrainServices } from "./personal-services";

export interface PersonalBrainContext {
  userId: string;
  account: string;
  githubToken: string;
  githubOwner?: string;
  githubAccount?: string;
  allSecrets: Record<string, string>;
  engineModel?: string;
  engineModelConfig?: EngineRuntimeModelConfig;
  perfTier?: ProviderPerfTier;
  flyToken?: string;
  flyOrgSlug: string;
  flyDefaultRegion: string;
}

function accountKey(userId: string): string {
  return `user-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
}

export async function resolvePersonalBrainContext(
  request?: Request,
): Promise<
  | { ok: true; context: PersonalBrainContext }
  | { ok: false; status: number; error: string }
> {
  const services = getPersonalBrainServices();
  const user = await services.resolveUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };

  const credentials = await services.getCredentials(user.id);
  const runtimeModel = (await services.getRuntimeModel?.(user.id)) ?? {};
  const flyToken = credentials.FLY_API_TOKEN || credentials.FLY_IO_TOKEN;
  const requestToken = request?.headers.get(KODY_AUTH_HEADERS.token)?.trim();
  const githubToken = requestToken || credentials.GITHUB_TOKEN || "";
  const githubIdentity = githubToken
    ? await resolveActorFromToken(githubToken)
    : null;
  if (requestToken && !githubIdentity) {
    return { ok: false, status: 401, error: "github_token_invalid" };
  }
  const githubAccount =
    githubIdentity?.login ?? credentials.GITHUB_LOGIN?.trim();
  const allSecrets = { ...credentials };
  delete allSecrets.FLY_API_TOKEN;
  delete allSecrets.FLY_IO_TOKEN;
  const convexUrl =
    process.env.CONVEX_URL?.trim() ||
    process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const serviceKey = process.env.KODY_SERVICE_KEY?.trim();
  if (convexUrl) allSecrets.CONVEX_URL = convexUrl;
  if (serviceKey) allSecrets.KODY_SERVICE_KEY = serviceKey;
  return {
    ok: true,
    context: {
      userId: user.id,
      account: accountKey(user.id),
      githubToken,
      ...(credentials.GITHUB_OWNER?.trim()
        ? { githubOwner: credentials.GITHUB_OWNER.trim() }
        : {}),
      ...(githubAccount ? { githubAccount } : {}),
      allSecrets,
      ...runtimeModel,
      ...(flyToken ? { flyToken } : {}),
      flyOrgSlug:
        credentials.FLY_ORG_SLUG?.trim() ||
        process.env.FLY_ORG_SLUG?.trim() ||
        "personal",
      flyDefaultRegion:
        credentials.FLY_DEFAULT_REGION?.trim() ||
        process.env.FLY_DEFAULT_REGION?.trim() ||
        "fra",
    },
  };
}
