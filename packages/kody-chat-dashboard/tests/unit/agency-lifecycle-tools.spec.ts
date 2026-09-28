import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgencyLifecycleTools } from "../../app/api/kody/chat/tools/agency-lifecycle-tools";

const ctx = {
  owner: "acme",
  repo: "app",
  listLoops: vi.fn(),
  readLoop: vi.fn(),
  saveLoop: vi.fn(),
  removeLoop: vi.fn(),
  runLoop: vi.fn(),
  listIntents: vi.fn(),
  readIntent: vi.fn(),
  saveIntent: vi.fn(),
  removeIntent: vi.fn(),
  listRuns: vi.fn(),
  readRun: vi.fn(),
};

describe("Agency lifecycle chat tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const value of Object.values(ctx)) {
      if (typeof value === "function" && "mockResolvedValue" in value) {
        value.mockResolvedValue({ ok: true });
      }
    }
  });

  it("manages Loops through the Dashboard API", async () => {
    const tools = createAgencyLifecycleTools(ctx);
    const loop = {
      id: "nightly",
      trigger: { type: "schedule" as const, every: "1d" },
      target: { kind: "workflow" as const, id: "release" },
      input: {},
      enabled: true,
    };

    await tools.list_loops.execute!({}, {} as never);
    await tools.read_loop.execute!({ loopId: "nightly" }, {} as never);
    await tools.create_or_update_loop.execute!(loop, {} as never);
    await tools.remove_loop.execute!({ loopId: "nightly" }, {} as never);
    await tools.run_loop.execute!({ loopId: "nightly" }, {} as never);

    expect(ctx.listLoops).toHaveBeenCalledOnce();
    expect(ctx.readLoop).toHaveBeenCalledWith("nightly");
    expect(ctx.saveLoop).toHaveBeenCalledWith(loop);
    expect(ctx.removeLoop).toHaveBeenCalledWith("nightly");
    expect(ctx.runLoop).toHaveBeenCalledWith("nightly");
  });

  it("manages Agency intents and reads immutable Runs", async () => {
    const tools = createAgencyLifecycleTools(ctx);

    await tools.list_intents.execute!({}, {} as never);
    await tools.read_intent.execute!({ slug: "grow" }, {} as never);
    await tools.create_or_update_intent.execute!(
      { slug: "grow", body: "Grow safely.", agent: ["kody"] },
      {} as never,
    );
    await tools.remove_intent.execute!({ slug: "grow" }, {} as never);
    await tools.list_agency_runs.execute!({ limit: 25 }, {} as never);
    await tools.read_agency_run.execute!(
      { runId: "runs/release-42.json", githubRunId: "42" },
      {} as never,
    );

    expect(ctx.saveIntent).toHaveBeenCalledWith({
      slug: "grow",
      body: "Grow safely.",
      agent: ["kody"],
    });
    expect(ctx.removeIntent).toHaveBeenCalledWith("grow");
    expect(ctx.listRuns).toHaveBeenCalledWith(25);
    expect(ctx.readRun).toHaveBeenCalledWith("runs/release-42.json", "42");
    expect(tools).not.toHaveProperty("delete_agency_run");
  });

  it("reports a missing entry as readable state instead of a failed tool", async () => {
    ctx.readIntent.mockResolvedValue({ error: "not_found", status: 404 });
    ctx.readLoop.mockResolvedValue({ error: "not_found", status: 404 });
    const tools = createAgencyLifecycleTools(ctx);

    await expect(
      tools.read_intent.execute!({ slug: "missing" }, {} as never),
    ).resolves.toEqual({ found: false });
    await expect(
      tools.read_loop.execute!({ loopId: "missing" }, {} as never),
    ).resolves.toEqual({ found: false });
  });
});
