import { describe, expect, it } from "vitest";

import { resolveClientSurfaceAccess } from "../../src/dashboard/lib/client-session/access";
import type { ClientSession } from "../../src/dashboard/lib/client-session/session";

const SESSION: ClientSession = {
  identity: {
    subject: "github:123",
    kind: "operator",
    name: "A Guy",
  },
  owner: "A-Guy-educ",
  repo: "A-Guy-Teacher",
  brandSlug: "acme",
  expiresAt: 2_000_000_000,
};

describe("client surface access", () => {
  it("allows an explicitly public brand without a session", () => {
    expect(
      resolveClientSurfaceAccess({
        access: { mode: "public" },
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
        session: null,
      }),
    ).toEqual({ kind: "public" });
  });

  it("requires a session for delegated access", () => {
    expect(
      resolveClientSurfaceAccess({
        access: { mode: "delegated" },
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
        session: null,
      }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("accepts only a session for the exact tenant and brand", () => {
    expect(
      resolveClientSurfaceAccess({
        access: { mode: "delegated" },
        owner: SESSION.owner,
        repo: SESSION.repo,
        brandSlug: SESSION.brandSlug,
        session: SESSION,
      }),
    ).toEqual({ kind: "authorized", identity: SESSION.identity });

    expect(
      resolveClientSurfaceAccess({
        access: { mode: "delegated" },
        owner: SESSION.owner,
        repo: SESSION.repo,
        brandSlug: "other",
        session: SESSION,
      }),
    ).toEqual({ kind: "forbidden" });
  });
});
