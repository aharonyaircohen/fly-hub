/**
 * Unit tests for the generic position tools
 * (app/api/kody/chat/tools/position-tools.ts): read/write a per-user
 * numeric position for a model-supplied key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  getUserState: vi.fn(),
  setUserState: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/user-state", () => ({
  getUserState: h.getUserState,
  setUserState: h.setUserState,
}));

import { createPositionTools } from "../../app/api/kody/chat/tools/position-tools";

const ctx = {
  octokit: {} as Octokit,
  owner: "acme",
  repo: "shop",
  userId: "operator:teacher",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getUserState.mockResolvedValue({ data: {} });
  h.setUserState.mockResolvedValue({});
});

describe("position tools", () => {
  it("get_position returns 0 when nothing is saved", async () => {
    const out = (await createPositionTools(ctx).get_position.execute!(
      { key: "record:sample" },
      {} as never,
    )) as { key: string; position: number };
    expect(out).toEqual({ key: "record:sample", position: 0 });
  });

  it("get_position reads the saved value for the namespaced key", async () => {
    h.getUserState.mockResolvedValue({
      data: { "position:record:sample": 3 },
    });
    const out = (await createPositionTools(ctx).get_position.execute!(
      { key: "record:sample" },
      {} as never,
    )) as { position: number };
    expect(out.position).toBe(3);
  });

  it("set_position writes the value into progress, namespaced", async () => {
    const out = (await createPositionTools(ctx).set_position.execute!(
      { key: "record:sample", position: 2 },
      {} as never,
    )) as { saved: boolean };
    expect(out.saved).toBe(true);
    expect(h.setUserState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "operator:teacher" }),
      "progress",
      { "position:record:sample": 2 },
      { source: "system" },
    );
  });
});
