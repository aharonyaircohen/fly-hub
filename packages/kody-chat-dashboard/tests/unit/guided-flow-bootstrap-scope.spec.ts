import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import {
  GUIDED_FLOW_BOOTSTRAP_COOKIE,
  createGuidedFlowBootstrapScope,
  readGuidedFlowBootstrapScope,
  setGuidedFlowBootstrapCookie,
} from "../../app/api/kody/guided-flows/bootstrap-scope";

describe("GuidedFlow bootstrap scope", () => {
  it("creates an isolated tenant and actor from one opaque id", () => {
    const scope = createGuidedFlowBootstrapScope();

    expect(scope.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(scope.tenantId).toBe(`bootstrap/${scope.id}`);
    expect(scope.actorId).toBe(`bootstrap:${scope.id}`);
  });

  it("rejects a malformed client-supplied bootstrap id", () => {
    const request = new NextRequest("https://dash.test", {
      headers: { cookie: `${GUIDED_FLOW_BOOTSTRAP_COOKIE}=shared-tenant` },
    });

    expect(readGuidedFlowBootstrapScope(request)).toBeNull();
  });

  it("writes a private same-site bootstrap cookie", () => {
    const response = NextResponse.json({ ok: true });
    const scope = createGuidedFlowBootstrapScope();

    setGuidedFlowBootstrapCookie(response, scope);

    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(
        `${GUIDED_FLOW_BOOTSTRAP_COOKIE}=${scope.id}.*HttpOnly.*SameSite=Lax`,
        "i",
      ),
    );
  });
});
