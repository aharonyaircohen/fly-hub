import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { userTenantIdFor } from "@dashboard/lib/backend/convex-backend";
import {
  repositoryScopeFor,
  personalScopeFor,
} from "@dashboard/lib/kody-scope";
import { requireKodyUser } from "./kody-user";

export async function resolveKodyRequestScope(req: NextRequest) {
  const user = await requireKodyUser();
  if (user instanceof NextResponse) return user;

  const repository = getRequestAuth(req);
  const personalTenantId = userTenantIdFor(user.id);
  if (!repository) {
    return {
      user,
      scope: personalScopeFor(user.id),
      tenantId: personalTenantId,
      personalTenantId,
      repository: null,
    } as const;
  }

  const access =
    req.method === "GET" || req.method === "HEAD"
      ? await verifyRepoReadAccess(req)
      : await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  return {
    user,
    scope: repositoryScopeFor(user.id, access.auth.owner, access.auth.repo),
    tenantId: `${access.auth.owner}/${access.auth.repo}`,
    personalTenantId,
    repository: access.auth,
  } as const;
}
