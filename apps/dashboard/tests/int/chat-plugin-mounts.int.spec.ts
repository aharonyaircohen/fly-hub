/**
 * @fileoverview Integration test for platform Step 4: the server-side plugin
 * tool registry merged into the REAL kody route handler
 * (/api/kody/chat/kody). A fixture server-half plugin registers a tool in
 * the module-scope singleton (chat/platform/server-tools) and the route:
 *
 *   - exposes the exact built-in tool map when zero plugins are registered,
 *   - exposes built-ins + the fixture tool once the plugin registers
 *     (additive only — no built-in is removed or replaced),
 *   - zod-validates fixture-tool input through the registry wrapper and
 *     threads the per-request server context (owner/repo/token),
 *   - returns 500 with a clear message when a plugin tool name collides
 *     with a built-in.
 *
 * The model + streaming layer is mocked (streamText captures the `tools`
 * option); everything else on the request path is the real route code.
 *
 * @testFramework vitest
 * @domain chat-contract
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "plugin-tester" })),
}));

vi.mock("@kody-ade/base/engine/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kody-ade/base/engine/config")>();
  return {
    ...actual,
    getEngineConfig: vi.fn(async () => ({
      config: { implementations: { default: "run" } },
      sha: null,
    })),
  };
});

vi.mock("@kody-ade/base/variables/load-chat-models", () => ({
  loadAutomaticModel: vi
    .fn()
    .mockResolvedValue({ default: false, engineDefault: false }),
  loadChatModels: vi.fn(async () => []),
}));

// Model resolution is mocked so the request gets past the 409 fallback and
// actually builds the tool map (the code under test).
vi.mock(
  "../../../../packages/kody-chat-dashboard/app/api/kody/chat/resolve-model",
  () => ({
    resolveChatModel: vi.fn(async () => ({
      model: {},
      resolvedModel: {
        id: "test/plugin-model",
        modelName: "plugin-model",
        provider: "test",
        protocol: "openai",
        apiKeySecret: "TEST_KEY",
        enabled: true,
      },
      apiKey: "test-key",
    })),
  }),
);

// Actor verification normally resolves the token via GitHub — keep the test
// hermetic. The rest of @dashboard/lib/auth (requireKodyAuth, getRequestAuth)
// stays real so header auth + repo context go through the actual code.
vi.mock("@kody-ade/base/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kody-ade/base/auth")>();
  return {
    ...actual,
    verifyActorLogin: vi.fn(async () => ({
      identity: { login: "plugin-tester", avatar_url: "", githubId: 1 },
    })),
  };
});

// Best-effort prompt loaders hit GitHub; stub them to their empty shapes.
vi.mock("@kody-ade/workspace/memory", () => ({
  loadRelevantMemoryForPrompt: vi.fn(async () => null),
  createMemoryRuntime: vi.fn(),
}));
vi.mock("@kody-ade/workspace/instructions/files", () => ({
  loadInstructionsForPrompt: vi.fn(async () => null),
}));
vi.mock("@kody-ade/workspace/context/files", () => ({
  loadContextForPrompt: vi.fn(async () => null),
}));
vi.mock("@dashboard/lib/view-renderers/renderers", () => ({
  loadViewRendererContextForPrompt: vi.fn(async () => ({
    rules: null,
    definitions: [],
  })),
}));

// Optional tool creation awaits GitHub reads on the request path — stub to empty.
const createCmsToolsMock = vi.hoisted(() => vi.fn(async () => ({})));
const createUserStateToolsMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("../../app/api/kody/chat/tools/cms-tools", () => ({
  createCmsTools: createCmsToolsMock,
}));

vi.mock("../../app/api/kody/chat/tools/user-state-tools", () => ({
  createUserStateTools: createUserStateToolsMock,
}));

// Capture the `tools` option handed to streamText; return a stub whose UI
// stream closes immediately so the real createUIMessageStream(Response)
// wrapping still runs.
const streamTextCalls: Array<Record<string, unknown>> = [];
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn((options: Record<string, unknown>) => {
      streamTextCalls.push(options);
      return {
        consumeStream: vi.fn(async () => undefined),
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
      };
    }),
  };
});

import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route";
import { getChatServerToolRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-tools";
import type { ChatToolServerContext } from "@kody-ade/kody-chat-dashboard/platform";

function makeRequest(userText = "Inspect repository status"): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: userText }] }),
  });
}

async function postAndCaptureToolNames(): Promise<{
  status: number;
  toolNames: string[];
  tools: Record<string, unknown>;
}> {
  const before = streamTextCalls.length;
  const res = await kodyChatPOST(makeRequest());
  const call = streamTextCalls[before];
  const tools = (call?.tools ?? {}) as Record<string, unknown>;
  return { status: res.status, toolNames: Object.keys(tools).sort(), tools };
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "chat-plugin-mounts-test-secret";
});

// The server tool registry is a module-scope singleton with no unregister,
// so ordering is load-bearing: Dashboard host → fixture plugin →
// collision plugin. vitest isolates modules per file, so this file owns a
// fresh singleton.
describe("kody route × chat plugin server tools (Step 4)", () => {
  let baselineToolNames: string[] = [];

  it("registers Dashboard-owned tools alongside the package built-ins", async () => {
    const { status, toolNames } = await postAndCaptureToolNames();
    expect(status).toBe(200);
    // Sanity: the built-in set is present and no plugin tool leaked in.
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).toContain("list_macros");
    expect(toolNames).toContain("list_notification_rules");
    expect(toolNames).toContain("export_company");
    expect(toolNames).toContain("list_inbox");
    expect(toolNames).not.toContain("fixture_echo");
    expect(toolNames.length).toBeGreaterThan(5);
    baselineToolNames = toolNames;
  });

  it("continues the chat when optional CMS tools cannot be loaded", async () => {
    createCmsToolsMock.mockRejectedValueOnce(
      new Error("CMS config unavailable"),
    );

    const { status, toolNames } = await postAndCaptureToolNames();

    expect(status).toBe(200);
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).not.toContain("cms_list_collections");
  });

  it("continues the chat when optional user-state tools cannot be loaded", async () => {
    createUserStateToolsMock.mockRejectedValueOnce(
      new Error("user-state config unavailable"),
    );

    const { status, toolNames } = await postAndCaptureToolNames();

    expect(status).toBe(200);
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).not.toContain("user_state_get");
  });

  it("fixture plugin tool is exposed additively and zod-validated with the request server context", async () => {
    const executions: Array<{ input: unknown; ctx: ChatToolServerContext }> =
      [];
    getChatServerToolRegistry().register("fixture", () => ({
      fixture_echo: {
        description: "Echo a message back (fixture plugin tool).",
        inputSchema: z.object({ message: z.string().min(1) }),
        execute: async (input, ctx) => {
          executions.push({ input, ctx });
          return { echoed: (input as { message: string }).message };
        },
      },
      remote_write: {
        description: "Must still be removed by the Kody chat tool policy.",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      },
    }));

    const { status, toolNames, tools } = await postAndCaptureToolNames();
    expect(status).toBe(200);
    // Additive only: baseline built-ins all still present, plus the fixture.
    expect(toolNames).toEqual([...baselineToolNames, "fixture_echo"].sort());
    expect(toolNames).not.toContain("remote_write");

    const fixtureTool = tools.fixture_echo as {
      description: string;
      execute: (input: unknown, options: unknown) => Promise<unknown>;
    };
    expect(fixtureTool.description).toContain("fixture plugin tool");

    // Valid input executes and receives the per-request server context.
    await expect(
      fixtureTool.execute({ message: "hello" }, {}),
    ).resolves.toEqual({ echoed: "hello" });
    expect(executions).toHaveLength(1);
    expect(executions[0].ctx).toEqual({
      owner: "owner",
      repo: "repo",
      token: "ghp_test",
      extras: {
        actorLogin: "plugin-tester",
        actorGithubId: 1,
      },
    });

    // Invalid input is rejected by the registry's zod wrapper BEFORE the
    // handler runs.
    await expect(
      fixtureTool.execute({ message: 42 }, {}),
    ).resolves.toMatchObject({
      error: expect.stringContaining("expected string"),
    });
    expect(executions).toHaveLength(1);
  });

  it("a plugin tool colliding with a built-in name fails the request with 500", async () => {
    getChatServerToolRegistry().register("colliding", () => ({
      fetch_url: {
        description: "Collides with the built-in fetch_url tool.",
        inputSchema: z.object({}),
        execute: async () => null,
      },
    }));

    const res = await kodyChatPOST(makeRequest());
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(String(data.error)).toMatch(/collision/i);
    expect(String(data.error)).toContain("fetch_url");
  });
});
