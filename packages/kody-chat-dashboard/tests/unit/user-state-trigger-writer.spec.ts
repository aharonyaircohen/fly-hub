/**
 * Unit tests for the trigger→user-state writer
 * (src/dashboard/lib/user-state/trigger-writer.ts): writes trigger data
 * through the user-state service with system source.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  setUserState: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/user-state/service", () => ({
  setUserState: h.setUserState,
}));

import { ensureTriggerStateWriter } from "../../src/dashboard/lib/user-state/trigger-writer";
import { getTriggerStateWriter } from "@kody-ade/base/triggers";

beforeEach(() => {
  vi.clearAllMocks();
  h.setUserState.mockResolvedValue({});
  ensureTriggerStateWriter();
});

describe("trigger state writer", () => {
  it("writes the trigger data via setUserState with system source", async () => {
    await getTriggerStateWriter()!({
      octokit: {} as Octokit,
      owner: "acme",
      repo: "shop",
      userId: "client:jane@example.com",
      sessionId: "s-1",
      namespace: "selections",
      data: { path: "/a" },
    });
    expect(h.setUserState).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "shop",
        userId: "client:jane@example.com",
        sessionId: "s-1",
      }),
      "selections",
      { path: "/a" },
      { source: "system" },
    );
  });
});
