/**
 * @fileoverview Integration coverage for action-state polling semantics.
 * @testFramework vitest
 * @domain actions
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "widget" })),
  getUserOctokit: vi.fn(async () => ({ request: vi.fn() })),
}));
const getActionStateMock = vi.hoisted(() => vi.fn());

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/kody-store/action-state", () => ({
  getActionState: getActionStateMock,
}));

import { GET } from "../../app/api/kody/action/state/[runId]/route";

function makeReq(): NextRequest {
  return new NextRequest("https://dash.test/api/kody/action/state/42");
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({ owner: "acme", repo: "widget" });
  auth.getUserOctokit.mockResolvedValue({ request: vi.fn() });
});

describe("GET /api/kody/action/state/:runId", () => {
  it("returns an empty successful state while a new action has no state yet", async () => {
    getActionStateMock.mockResolvedValue(null);

    const res = await GET(makeReq(), {
      params: Promise.resolve({ runId: "42" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: null });
  });
});
