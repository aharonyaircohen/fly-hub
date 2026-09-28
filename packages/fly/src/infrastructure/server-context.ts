import type { NextRequest } from "next/server";

import {
  providerConfigFromContext,
  resolveProviderContext,
  type ProviderContext,
  type ProviderRuntimeConfig,
} from "./server-operations";

export type ServerProviderContext = ProviderContext;
export type ServerProviderConfig = ProviderRuntimeConfig;

export function resolveServerProviderContext(
  req: NextRequest,
  options?: { repoOverride?: { owner: string; repo: string } },
) {
  return resolveProviderContext(req, options);
}

export async function resolveRequiredServerProviderContext(
  req: NextRequest,
  options?: { repoOverride?: { owner: string; repo: string } },
) {
  const resolved = await resolveServerProviderContext(req, options);
  if (!resolved.ok) return resolved;
  if (!providerConfigFromContext(resolved.context)) {
    return {
      ok: false as const,
      status: 503,
      error: "fly_token_missing",
      message: "FLY_API_TOKEN not in this repo's secrets vault.",
    };
  }
  return resolved;
}

export function serverProviderConfigFromContext(
  context: ServerProviderContext,
): ServerProviderConfig | null {
  return providerConfigFromContext(context);
}
