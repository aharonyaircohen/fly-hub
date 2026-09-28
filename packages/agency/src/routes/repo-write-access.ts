import { NextRequest, NextResponse } from "next/server";
import {
  verifyRepoWriteAccess as verifyBaseRepoWriteAccess,
  type RequestAuth,
} from "@kody-ade/base/auth";

export type VerifiedRepoWriter = {
  auth: RequestAuth;
  actorLogin: string;
};

export async function verifyRepoWriteAccess(
  req: NextRequest,
): Promise<VerifiedRepoWriter | NextResponse> {
  const access = await verifyBaseRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  return { auth: access.auth, actorLogin: access.actorLogin };
}
