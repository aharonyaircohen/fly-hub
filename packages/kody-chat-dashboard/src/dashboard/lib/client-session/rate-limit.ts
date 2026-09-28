import "server-only";

import { createHash } from "node:crypto";
import { createBackendClient } from "@kody-ade/backend/client";
import { api } from "@kody-ade/backend/api";

const WINDOW_SEC = 60;
const REQUESTS_PER_WINDOW = 30;

export async function checkExternalLaunchRateLimit(
  request: Request,
  tenantId: string,
): Promise<boolean> {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0]?.trim() || "unknown";
  const addressHash = createHash("sha256").update(address).digest("hex");
  return (await createBackendClient().mutation(
    api.clientLaunchRateLimits.check,
    {
      key: `${tenantId}:${addressHash}`,
      now: Math.floor(Date.now() / 1000),
      windowSec: WINDOW_SEC,
      limit: REQUESTS_PER_WINDOW,
    },
  )) as boolean;
}
