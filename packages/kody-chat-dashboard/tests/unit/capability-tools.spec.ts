import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  browserCapabilityActionInputSchema,
  browserCapabilityActionSchema,
  createCapabilityTools,
} from "../../app/api/kody/chat/tools/capability-tools";

const ctx = {
  owner: "acme",
  repo: "app",
  octokit: {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
      },
      actions: { createWorkflowDispatch: vi.fn() },
    },
  },
  listCapabilities: vi.fn(),
  readCapability: vi.fn(),
  saveCapability: vi.fn(),
  removeCapability: vi.fn(),
  runCapability: vi.fn(),
};

describe("capability chat tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.listCapabilities.mockResolvedValue({ capabilities: [] });
    ctx.readCapability.mockResolvedValue({ capability: { slug: "greet" } });
    ctx.saveCapability.mockResolvedValue({ capability: { slug: "greet" } });
    ctx.removeCapability.mockResolvedValue({ success: true });
    ctx.runCapability.mockResolvedValue({ ok: true, capability: "greet" });
  });

  it("requires the fields belonging to each browser operation", () => {
    expect(
      browserCapabilityActionSchema.safeParse({
        slug: "prepare-facebook-post",
        op: "navigate",
        selector: "https://www.facebook.com",
        reason: "Open Facebook",
      }).success,
    ).toBe(false);
    expect(
      browserCapabilityActionSchema.safeParse({
        slug: "prepare-facebook-post",
        op: "fill",
        selector: '[role="textbox"]',
        reason: "Fill the composer",
      }).success,
    ).toBe(false);
    expect(
      browserCapabilityActionSchema.safeParse({
        slug: "prepare-facebook-post",
        op: "fill",
        selector: '[role="textbox"]',
        value: "Exact draft",
        reason: "Fill the composer",
      }).success,
    ).toBe(true);
  });

  it("accepts click through the provider-facing flat action schema", () => {
    expect(
      browserCapabilityActionInputSchema.safeParse({
        slug: "prepare-facebook-post",
        op: "click",
        selector: '[aria-label="Create a post"]',
        reason: "Open the composer",
      }).success,
    ).toBe(true);
    expect(
      browserCapabilityActionInputSchema.safeParse({
        slug: "prepare-facebook-post",
        op: "click",
        reason: "Open the composer",
      }).success,
    ).toBe(false);
  });

  it("limits user-browser capability actions to the declared grant", async () => {
    ctx.readCapability.mockResolvedValue({
      capability: {
        slug: "draft-facebook-personal-post",
        instructions: "Prepare the post and stop before publishing.",
        contract: JSON.stringify({
          execution: "agent",
          requirements: {
            browser: true,
            browserSession: "user",
            browserActions: ["navigate", "click", "fill", "upload", "wait"],
            browserOrigins: ["https://www.facebook.com"],
            browserFileRoots: ["content-studio"],
          },
          input: {},
          output: {},
        }),
      },
    });
    const tools = createCapabilityTools(ctx as never);

    await expect(
      tools.browser_capability_act.execute!(
        {
          slug: "draft-facebook-personal-post",
          op: "navigate",
          url: "https://www.facebook.com/",
          reason: "Open Facebook for the draft.",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      action: "preview_act",
      capabilitySlug: "draft-facebook-personal-post",
      op: "navigate",
      allowedOrigins: ["https://www.facebook.com"],
    });

    await expect(
      tools.browser_capability_act.execute!(
        {
          slug: "draft-facebook-personal-post",
          op: "upload",
          selector: "input[type=file]",
          paths: ["content-studio/post/01-cover.jpg"],
          reason: "Attach the post media.",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      op: "upload",
      paths: ["content-studio/post/01-cover.jpg"],
    });

    await expect(
      tools.browser_capability_act.execute!(
        {
          slug: "draft-facebook-personal-post",
          op: "upload",
          selector: "input[type=file]",
          paths: ["secrets/private.jpg"],
          reason: "Attach the post media.",
        },
        {} as never,
      ),
    ).resolves.toEqual({ error: "browser_file_not_allowed" });

    await expect(
      tools.browser_capability_act.execute!(
        {
          slug: "draft-facebook-personal-post",
          op: "navigate",
          url: "https://example.com/",
          reason: "Navigate elsewhere.",
        },
        {} as never,
      ),
    ).resolves.toEqual({ error: "browser_origin_not_allowed" });
  });

  it("lists and reads local or active Store capabilities through the Dashboard API", async () => {
    const tools = createCapabilityTools(ctx as never);

    await tools.list_capabilities.execute!({}, {} as never);
    await tools.read_capability.execute!({ slug: "greet" }, {} as never);

    expect(ctx.listCapabilities).toHaveBeenCalledOnce();
    expect(ctx.readCapability).toHaveBeenCalledWith("greet");
  });

  it("reports a missing capability as readable state", async () => {
    ctx.readCapability.mockResolvedValue({ error: "not_found", status: 404 });
    const tools = createCapabilityTools(ctx as never);

    await expect(
      tools.read_capability.execute!({ slug: "missing" }, {} as never),
    ).resolves.toEqual({ found: false });
  });

  it("saves the whole capability through the Dashboard API", async () => {
    const tools = createCapabilityTools(ctx as never);
    await tools.create_or_update_capability.execute!(
      {
        slug: "greet-script",
        instructions: "say hello deterministically",
        contract: {
          execution: "script",
          connections: ["facebook-main"],
          secrets: ["DEPLOY_TOKEN"],
          timeoutMs: 1_800_000,
          input: {},
          output: {},
        },
        tools: [{ path: "run.sh", content: "#!/bin/sh\nprintf '{}'\n" }],
        skills: [],
      },
      {} as never,
    );

    expect(ctx.saveCapability).toHaveBeenCalledWith({
      slug: "greet-script",
      instructions: "say hello deterministically",
      contract: expect.stringContaining('"execution": "script"'),
      tools: [{ path: "run.sh", content: "#!/bin/sh\nprintf '{}'\n" }],
      skills: [],
    });
    expect(ctx.saveCapability.mock.calls[0]![0].contract).toContain(
      '"connections": [',
    );
  });

  it("removes or runs a capability through the Dashboard API", async () => {
    const tools = createCapabilityTools(ctx as never);

    await expect(
      tools.delete_capability.execute!({ slug: "greet" }, {} as never),
    ).resolves.toEqual({ success: true });
    await expect(
      tools.run_capability.execute!({ slug: "greet" }, {} as never),
    ).resolves.toMatchObject({ ok: true, capability: "greet" });

    expect(ctx.removeCapability).toHaveBeenCalledWith("greet");
    expect(ctx.runCapability).toHaveBeenCalledWith("greet");
  });

  it("keeps a user-browser capability in the current chat instead of dispatching it", async () => {
    ctx.readCapability.mockResolvedValue({
      capability: {
        slug: "prepare-facebook-post",
        instructions: "Prepare the post in the visible browser.",
        contract: JSON.stringify({
          execution: "agent",
          requirements: {
            browser: true,
            browserOnly: true,
            browserSession: "user",
            browserActions: ["navigate", "click", "fill", "scroll", "wait"],
            browserOrigins: ["https://www.facebook.com"],
          },
          input: {},
          output: {},
        }),
      },
    });
    const tools = createCapabilityTools(ctx as never);

    await expect(
      tools.run_capability.execute!(
        { slug: "prepare-facebook-post" },
        {} as never,
      ),
    ).resolves.toMatchObject({
      ok: true,
      capability: "prepare-facebook-post",
      execution: "user_browser",
      nextTool: "browser_capability_act",
    });
    expect(ctx.runCapability).not.toHaveBeenCalled();
  });
});
