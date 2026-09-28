import "server-only";

import { verifyActorLogin } from "@kody-ade/base/auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { operatorIdentityFromRequest } from "./operator-session";

export async function verifyOperatorActor(
  req: NextRequest,
  suppliedLogin?: string,
) {
  const identity = await operatorIdentityFromRequest(req);
  if (!identity) return await verifyActorLogin(req, suppliedLogin);
  if (suppliedLogin && suppliedLogin !== identity.login) {
    return NextResponse.json(
      { error: "actor_mismatch", message: "Actor does not match session." },
      { status: 403 },
    );
  }
  return { identity };
}
