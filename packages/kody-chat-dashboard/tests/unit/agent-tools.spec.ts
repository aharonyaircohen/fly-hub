import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentAdminTools } from "../../app/api/kody/chat/tools/agent-admin-tools";
import { createAgentTools } from "../../app/api/kody/chat/tools/agent-tools";

const ctx = {
  owner: "acme",
  repo: "app",
  listAgents: vi.fn(),
  readAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  removeAgent: vi.fn(),
  dispatchAgent: vi.fn(),
};

describe("agent chat tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.listAgents.mockResolvedValue({ agent: [] });
    ctx.readAgent.mockResolvedValue({ agentMember: { slug: "qa" } });
    ctx.createAgent.mockResolvedValue({ agentMember: { slug: "qa" } });
    ctx.updateAgent.mockResolvedValue({ agentMember: { slug: "qa" } });
    ctx.removeAgent.mockResolvedValue({ success: true });
    ctx.dispatchAgent.mockResolvedValue({ ok: true });
  });

  it("creates an agent through the Dashboard API", async () => {
    const tools = createAgentTools(ctx as never);
    await tools.create_kody_agent.execute!(
      { title: "QA", purpose: "Checks releases." },
      {} as never,
    );

    expect(ctx.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "qa",
        title: "QA",
        body: expect.stringContaining("Checks releases."),
      }),
    );
  });

  it("lists, reads, updates, removes, and dispatches agents through the Dashboard API", async () => {
    const tools = createAgentAdminTools(ctx as never);

    await tools.list_agents.execute!({}, {} as never);
    await tools.read_agent.execute!({ slug: "qa" }, {} as never);
    await tools.update_agent.execute!(
      { slug: "qa", title: "QA Lead", body: "Checks all releases." },
      {} as never,
    );
    await tools.delete_agent.execute!({ slug: "qa" }, {} as never);
    await tools.dispatch_agent.execute!(
      { slug: "qa", message: "Check release 42" },
      {} as never,
    );

    expect(ctx.listAgents).toHaveBeenCalledOnce();
    expect(ctx.readAgent).toHaveBeenCalledWith("qa");
    expect(ctx.updateAgent).toHaveBeenCalledWith("qa", {
      title: "QA Lead",
      body: "Checks all releases.",
    });
    expect(ctx.removeAgent).toHaveBeenCalledWith("qa");
    expect(ctx.dispatchAgent).toHaveBeenCalledWith("qa", "Check release 42");
  });
});
