import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
export async function checkAppRateLimit(input: {
  tenantId: string;
  actor: string;
  action: string;
  windowSec?: number;
  limit?: number;
}) {
  return (await createBackendClient().mutation(
    backendApi.clientLaunchRateLimits.check,
    {
      key: `apps:${input.tenantId}:${input.actor}:${input.action}`,
      now: Math.floor(Date.now() / 1000),
      windowSec: input.windowSec ?? 60,
      limit: input.limit ?? 30,
    },
  )) as boolean;
}
