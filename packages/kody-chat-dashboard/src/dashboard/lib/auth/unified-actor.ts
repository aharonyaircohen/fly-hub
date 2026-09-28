/**
 * @fileType utility
 * @domain auth
 * @pattern unified-actor
 * @ai-summary Resolves "who is this request from" across the two auth
 *   systems: dashboard operators (header PAT) and delegated brand users
 *   (internal client session). Returns a stable userId plus the brand context
 *   — the identity used by
 *   system events and user-state. Never trusts client-claimed identity:
 *   operator login comes from headers set alongside the PAT, while delegated
 *   identity comes from the signed client-session cookie.
 */
import "server-only";
import type { NextRequest } from "next/server";
import { getRequestAuth } from "@kody-ade/base/auth";
import {
  CLIENT_SESSION_COOKIE,
  verifyClientSession,
} from "../client-session/session";
import type { SystemEventBrand } from "@kody-ade/base/events/types";

export type UnifiedActorKind = "operator" | "client";

export interface UnifiedActor {
  /** Stable id: `operator:<login>` or `client:<external-subject>`. */
  userId: string;
  kind: UnifiedActorKind;
  brand: SystemEventBrand | null;
  /** Operator PAT when kind is "operator" — used for backend access. */
  token: string | null;
}

/**
 * Resolve the acting user for a request. Operator headers win over a client
 * session (a dashboard operator may also carry a client cookie).
 */
export async function resolveUnifiedActor(
  req: NextRequest,
): Promise<UnifiedActor | null> {
  const operator = getRequestAuth(req);
  if (operator) {
    return {
      userId: `operator:${(operator.userLogin ?? "unknown").toLowerCase()}`,
      kind: "operator",
      brand: { owner: operator.owner, repo: operator.repo },
      token: operator.token,
    };
  }

  const session = await verifyClientSession(
    req.cookies.get(CLIENT_SESSION_COOKIE)?.value,
  );
  if (!session) return null;
  return {
    userId: `client:${session.identity.subject}`,
    kind: "client",
    brand: { owner: session.owner, repo: session.repo },
    token: null,
  };
}
