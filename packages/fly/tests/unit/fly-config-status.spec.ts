/**
 * @fileoverview Repo-owned Fly credential status API.
 * @testFramework vitest
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireKodyAuth = vi.fn();
const resolveServerProviderContext = vi.fn();

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...args: unknown[]) => requireKodyAuth(...args),
}));

vi.mock("../../src/infrastructure/server-context", () => ({
  resolveServerProviderContext: (...args: unknown[]) =>
    resolveServerProviderContext(...args),
}));

import { GET } from "../../src/routes/fly-config-status";

const req = {} as NextRequest;

describe("GET /api/kody/fly/config-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireKodyAuth.mockResolvedValue(null);
  });

  it("reports the repo-owned credential without exposing it", async () => {
    resolveServerProviderContext.mockResolvedValue({
      ok: true,
      context: {
        flyToken: "fly-secret",
        providerTokenSource: "repo-vault",
      },
    });

    const response = await GET(req);

    expect(await response.json()).toEqual({
      configured: true,
      source: "repo-vault",
    });
  });

  it("reports when the repo has no token", async () => {
    resolveServerProviderContext.mockResolvedValue({
      ok: true,
      context: {
        flyToken: undefined,
        providerTokenSource: null,
      },
    });

    const response = await GET(req);

    expect(await response.json()).toEqual({ configured: false, source: null });
  });
});
