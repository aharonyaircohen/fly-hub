import { describe, expect, it, vi } from "vitest";
import {
  activateLiveAgent,
  deactivateLiveAgent,
  readLiveAgentStatus,
  setLiveAgentPaused,
} from "@dashboard/features/agency/server/live-agent-lifecycle";

const agent = {
  slug: "operations-agent",
  title: "Operations Agent",
  body: "Keep operations healthy.",
  primaryIntent: "healthy-operations",
};
const intent = { slug: "healthy-operations", body: "Keep production healthy." };

function dependencies() {
  return {
    readAgent: vi.fn().mockResolvedValue(agent),
    readIntent: vi.fn().mockResolvedValue(intent),
    assignPrimaryIntent: vi.fn(),
    clearPrimaryIntent: vi.fn(),
    readLoop: vi.fn().mockResolvedValue(null),
    saveLoop: vi.fn(),
    deleteLoop: vi.fn(),
    readState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn(),
    resetState: vi.fn(),
    now: () => "2026-08-19T00:00:00.000Z",
  };
}

describe("live Agent lifecycle", () => {
  it("activates an Agent by assigning Intent, creating state, and creating one Loop", async () => {
    const deps = dependencies();

    const status = await activateLiveAgent(
      { agent: agent.slug, intent: intent.slug, every: "1h" },
      deps,
    );

    expect(deps.assignPrimaryIntent).toHaveBeenCalledWith(agent, intent.slug);
    expect(deps.saveState).toHaveBeenCalledWith({
      version: 1,
      agent: agent.slug,
      revision: 0,
      cursor: "",
      summary: "",
      data: {},
      updatedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(deps.saveLoop).toHaveBeenCalledWith({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "capability", id: "live-agent" },
      input: { agent: agent.slug, intent: intent.slug },
      enabled: true,
    });
    expect(status).toMatchObject({ live: true, paused: false, intent: intent.slug });
  });

  it("refuses to replace an unrelated Loop", async () => {
    const deps = dependencies();
    deps.readLoop.mockResolvedValue({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1d" },
      target: { kind: "workflow", id: "release" },
      input: {},
      enabled: true,
    });

    await expect(
      activateLiveAgent(
        { agent: agent.slug, intent: intent.slug, every: "1h" },
        deps,
      ),
    ).rejects.toThrow("reserved Loop id");
    expect(deps.saveState).not.toHaveBeenCalled();
  });

  it("recognizes and migrates the previous Agent-target Live Loop", async () => {
    const deps = dependencies();
    deps.readLoop.mockResolvedValue({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "agent", id: agent.slug },
      input: { intent: intent.slug },
      enabled: true,
    });
    deps.readState.mockResolvedValue({
      version: 1,
      agent: agent.slug,
      revision: 0,
      cursor: "",
      summary: "",
      data: {},
      updatedAt: "2026-08-19T00:00:00.000Z",
    });

    await expect(readLiveAgentStatus(agent.slug, deps)).resolves.toMatchObject({
      live: true,
      consistency: "ready",
    });

    await activateLiveAgent(
      { agent: agent.slug, intent: intent.slug, every: "2h" },
      deps,
    );

    expect(deps.saveLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "capability", id: "live-agent" },
        input: { agent: agent.slug, intent: intent.slug },
      }),
    );
  });

  it("rolls back new state and the Intent relation when Loop creation fails", async () => {
    const deps = dependencies();
    deps.readAgent.mockResolvedValue({ ...agent, primaryIntent: undefined });
    deps.saveLoop.mockRejectedValue(new Error("Loop write failed"));

    await expect(
      activateLiveAgent(
        { agent: agent.slug, intent: intent.slug, every: "1h" },
        deps,
      ),
    ).rejects.toThrow("Loop write failed");

    expect(deps.resetState).toHaveBeenCalledWith(agent.slug);
    expect(deps.clearPrimaryIntent).toHaveBeenCalledWith({
      ...agent,
      primaryIntent: undefined,
    });
  });

  it("restores the previous Intent when updating a live Agent fails", async () => {
    const deps = dependencies();
    deps.readState.mockResolvedValue({
      version: 1,
      agent: agent.slug,
      revision: 3,
      cursor: "run-3",
      summary: "Previous work",
      data: {},
      updatedAt: "2026-08-19T00:00:00.000Z",
    });
    deps.saveLoop.mockRejectedValue(new Error("Loop write failed"));

    await expect(
      activateLiveAgent(
        { agent: agent.slug, intent: "new-intent", every: "2h" },
        { ...deps, readIntent: vi.fn().mockResolvedValue({ slug: "new-intent", body: "New" }) },
      ),
    ).rejects.toThrow("Loop write failed");

    expect(deps.assignPrimaryIntent).toHaveBeenNthCalledWith(1, agent, "new-intent");
    expect(deps.assignPrimaryIntent).toHaveBeenNthCalledWith(
      2,
      agent,
      "healthy-operations",
    );
    expect(deps.resetState).not.toHaveBeenCalled();
    expect(deps.clearPrimaryIntent).not.toHaveBeenCalled();
  });

  it("pauses only the Agent Loop and preserves state", async () => {
    const deps = dependencies();
    deps.readLoop.mockResolvedValue({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "capability", id: "live-agent" },
      input: { agent: agent.slug, intent: intent.slug },
      enabled: true,
    });

    await setLiveAgentPaused(agent.slug, true, deps);

    expect(deps.saveLoop).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(deps.resetState).not.toHaveBeenCalled();
  });

  it("stops live operation without deleting the Agent or Intent", async () => {
    const deps = dependencies();
    deps.readLoop.mockResolvedValue({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "capability", id: "live-agent" },
      input: { agent: agent.slug, intent: intent.slug },
      enabled: true,
    });

    await deactivateLiveAgent(agent.slug, deps);

    expect(deps.deleteLoop).toHaveBeenCalledWith("live-agent-operations-agent");
    expect(deps.resetState).toHaveBeenCalledWith(agent.slug);
    expect(deps.clearPrimaryIntent).toHaveBeenCalledWith(agent);
  });

  it("does not report an incomplete configuration as live", async () => {
    const deps = dependencies();
    deps.readLoop.mockResolvedValue({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "capability", id: "live-agent" },
      input: { agent: agent.slug, intent: intent.slug },
      enabled: true,
    });

    await expect(readLiveAgentStatus(agent.slug, deps)).resolves.toMatchObject({
      live: false,
      consistency: "missing-state",
    });
  });
});
