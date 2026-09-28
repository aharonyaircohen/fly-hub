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

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import type { ViewRendererDefinition } from "../../src/dashboard/lib/view-renderers/standalone-renderer-store";

const verifyActorLoginMock = vi.hoisted(() =>
  vi.fn(async (_req: unknown, _suppliedLogin?: string) => ({
    identity: { login: "plugin-tester", avatar_url: "", githubId: 1 },
  })),
);

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
vi.mock("../../app/api/kody/chat/resolve-model", () => ({
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
}));

// Actor verification normally resolves the token via GitHub — keep the test
// hermetic. The rest of the local auth module (requireKodyAuth, getRequestAuth)
// stays real so header auth + repo context go through the actual code.
vi.mock("@kody-ade/base/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kody-ade/base/auth")>();
  return {
    ...actual,
    verifyActorLogin: verifyActorLoginMock,
  };
});

// Best-effort prompt loaders hit GitHub; stub them to their empty shapes.
const loadRelevantMemoryForPromptMock = vi.hoisted(() =>
  vi.fn(async () => null),
);
vi.mock("@kody-ade/workspace/memory", () => ({
  loadRelevantMemoryForPrompt: loadRelevantMemoryForPromptMock,
  createMemoryRuntime: vi.fn(),
}));
vi.mock("@kody-ade/workspace/instructions/files", () => ({
  loadInstructionsForPrompt: vi.fn(async () => null),
}));
vi.mock("@kody-ade/workspace/context/files", () => ({
  loadContextForPrompt: vi.fn(async () => null),
}));
const loadViewRendererContextForPromptMock = vi.hoisted(() =>
  vi.fn(async () => ({
    rules: null as string | null,
    definitions: [] as ViewRendererDefinition[],
  })),
);
vi.mock(
  "../../src/dashboard/lib/view-renderers/standalone-renderer-store",
  () => ({
    loadViewRendererContextForPrompt: loadViewRendererContextForPromptMock,
  }),
);

// CMS tool creation awaits GitHub reads on the request path — stub to empty.
const createCmsToolsMock = vi.hoisted(() => vi.fn(async () => ({})));
const createUserStateToolsMock = vi.hoisted(() => vi.fn(async () => ({})));
const listResolvedAgentFilesMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      Array<{
        slug: string;
        title: string;
        body: string;
        capabilities?: string[];
        subagents?: string[];
        updatedAt: string;
        htmlUrl: string;
      }>
    > => [],
  ),
);

vi.mock("../../app/api/kody/chat/tools/cms-tools", () => ({
  createCmsTools: createCmsToolsMock,
}));

vi.mock("../../app/api/kody/chat/tools/user-state-tools", () => ({
  createUserStateTools: createUserStateToolsMock,
}));

vi.mock("../../src/dashboard/lib/agent-files", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/dashboard/lib/agent-files")
    >();
  return {
    ...actual,
    listResolvedAgentFiles: listResolvedAgentFilesMock,
  };
});

// Capture the `tools` option handed to streamText; return a stub whose UI
// stream closes immediately so the real createUIMessageStream(Response)
// wrapping still runs.
const streamTextCalls: Array<Record<string, unknown>> = [];
let nextUiMessageChunks: Array<Record<string, unknown>> | null = null;
type SpecialistStreamFixture = {
  parts?: Array<Record<string, unknown>>;
  text?: string;
  reasoningText?: string;
  steps?: Array<Record<string, unknown>>;
  error?: Error;
};
let nextSpecialistStream: SpecialistStreamFixture | null = null;
let nextSpecialistStreams: SpecialistStreamFixture[] = [];
const generateTextMock = vi.hoisted(() =>
  vi.fn(
    async (
      _options?: Record<string, unknown>,
    ): Promise<{
      text: string;
      reasoningText?: string;
      steps?: Array<Record<string, unknown>>;
    }> => ({
      text: '{"mode":"self","assignments":[]}',
    }),
  ),
);
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
    streamText: vi.fn((options: Record<string, unknown>) => {
      streamTextCalls.push(options);
      const specialistStream =
        nextSpecialistStreams.shift() ?? nextSpecialistStream;
      if (specialistStream) {
        if (specialistStream === nextSpecialistStream) {
          nextSpecialistStream = null;
        }
        return {
          fullStream: (async function* () {
            if (specialistStream.error) throw specialistStream.error;
            for (const part of specialistStream.parts ?? []) yield part;
          })(),
          text: Promise.resolve(specialistStream.text ?? ""),
          reasoningText: Promise.resolve(specialistStream.reasoningText ?? ""),
          steps: Promise.resolve(specialistStream.steps ?? []),
        };
      }
      const chunks = nextUiMessageChunks;
      nextUiMessageChunks = null;
      return {
        consumeStream: vi.fn(async () => undefined),
        toUIMessageStream: () =>
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks ?? []) controller.enqueue(chunk);
              controller.close();
            },
          }),
      };
    }),
  };
});

import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route";
import { setChatRequestContextProvider } from "../../app/api/kody/chat/request-context-provider";
import { getChatServerToolRegistry } from "../../src/dashboard/lib/chat/platform/server-tools";
import type { ChatToolServerContext } from "../../src/dashboard/lib/chat/platform";

function makeRequest(
  userText = "Inspect repository status",
  extraBody: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: userText }],
      ...extraBody,
    }),
  });
}

function makePersonalRequest(userText = "Show my Kody setup"): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: userText }] }),
  });
}

async function postAndCaptureToolNames(userText?: string): Promise<{
  status: number;
  toolNames: string[];
  tools: Record<string, unknown>;
  response: Response;
}> {
  const before = streamTextCalls.length;
  const res = await kodyChatPOST(makeRequest(userText));
  const call = streamTextCalls[before];
  const tools = (call?.tools ?? {}) as Record<string, unknown>;
  return {
    status: res.status,
    toolNames: Object.keys(tools).sort(),
    tools,
    response: res,
  };
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "chat-plugin-mounts-test-secret";
});

afterEach(() => {
  setChatRequestContextProvider(null);
  nextUiMessageChunks = null;
  nextSpecialistStream = null;
  nextSpecialistStreams = [];
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({
    text: '{"mode":"self","assignments":[]}',
  });
});

// The server tool registry is a module-scope singleton with no unregister,
// so ordering is load-bearing: baseline (zero plugins) → fixture plugin →
// collision plugin. vitest isolates modules per file, so this file owns a
// fresh singleton.
describe("kody route × chat plugin server tools (Step 4)", () => {
  let baselineToolNames: string[] = [];

  it("zero plugins registered: streams with the built-in tool map only", async () => {
    const { status, toolNames } = await postAndCaptureToolNames();
    expect(status).toBe(200);
    expect(loadRelevantMemoryForPromptMock).toHaveBeenCalledWith(
      {
        actor: { kind: "user", id: "github:1" },
        tenantId: "owner/repo",
      },
      "Inspect repository status",
    );
    // Sanity: the built-in set is present and no plugin tool leaked in.
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).not.toContain("fixture_echo");
    expect(toolNames.length).toBeGreaterThan(5);
    baselineToolNames = toolNames;
  });

  it("keeps a conversational greeting fast and limits it to the final answer tool", async () => {
    listResolvedAgentFilesMock.mockResolvedValueOnce([
      {
        slug: "kody",
        title: "Kody",
        body: "Coordinates assigned specialists.",
        subagents: ["agency-specialist"],
        updatedAt: "",
        htmlUrl: "",
      },
      {
        slug: "agency-specialist",
        title: "Agency Specialist",
        body: "Manages Agents, Workflows, Capabilities, and Todos.",
        updatedAt: "",
        htmlUrl: "",
      },
    ]);
    nextUiMessageChunks = [
      { type: "text-start", id: "reply" },
      { type: "text-delta", id: "reply", delta: "Hello!" },
      { type: "text-end", id: "reply" },
    ];

    const generateCallsBefore = generateTextMock.mock.calls.length;
    const streamTextCallCountBefore = streamTextCalls.length;
    const { status, toolNames } = await postAndCaptureToolNames(
      "Hi, what can you help me with?",
    );

    expect(status).toBe(200);
    expect(toolNames).toEqual(["final_answer"]);
    expect(generateTextMock).toHaveBeenCalledTimes(generateCallsBefore);
    expect(streamTextCalls.at(streamTextCallCountBefore)?.system).toContain(
      "Do not infer Kody's overall capabilities from this turn's reduced tool list",
    );
  });

  it("mounts specialist evidence inside Kody's normal model turn", async () => {
    listResolvedAgentFilesMock.mockResolvedValueOnce([
      {
        slug: "kody",
        title: "Kody",
        body: "Coordinates assigned specialists.",
        subagents: ["ui-vibe-specialist"],
        updatedAt: "",
        htmlUrl: "",
      },
      {
        slug: "ui-vibe-specialist",
        title: "UI/Vibe Specialist",
        body: "Investigates focused product questions.",
        capabilities: ["builtin-agent-ui-vibe-specialist"],
        updatedAt: "",
        htmlUrl: "",
      },
    ]);

    const before = streamTextCalls.length;
    const response = await kodyChatPOST(makeRequest("Investigate this issue"));
    const call = streamTextCalls[before];

    expect(response.status).toBe(200);
    expect(listResolvedAgentFilesMock).toHaveBeenLastCalledWith({
      storeFailure: "omit",
    });
    expect(call?.tools).toHaveProperty("request_specialist_evidence");
    expect(call?.tools).toHaveProperty("final_answer");
    expect(call?.system).toContain("You own this complete turn");

    generateTextMock.mockImplementationOnce(async (options) => {
      const featureTool = (
        options as {
          tools: Record<string, { execute(input: unknown): Promise<unknown> }>;
        }
      ).tools.list_dashboard_features;
      const output = await featureTool.execute({});
      return {
        text: "The specialist found grounded evidence.",
        reasoningText: "",
        steps: [
          {
            toolResults: [{ toolName: "list_dashboard_features", output }],
          },
        ],
      };
    });
    const evidenceTool = (
      call?.tools as Record<
        string,
        {
          execute?: (
            input: unknown,
            options: unknown,
          ) => AsyncIterable<Record<string, unknown>>;
        }
      >
    ).request_specialist_evidence;
    const evidenceExecution = evidenceTool.execute?.(
      {
        assignments: [
          { agent: "ui-vibe-specialist", task: "Investigate the issue" },
        ],
      },
      {},
    );
    const evidencePromise = (async () => {
      let final: unknown;
      for await (const output of evidenceExecution ?? []) {
        final = output;
      }
      return final;
    })();
    const evidence = await Promise.race([
      evidencePromise,
      new Promise<"deadlocked">((resolve) =>
        setTimeout(() => resolve("deadlocked"), 500),
      ),
    ]);

    expect(evidence).not.toBe("deadlocked");
    expect(evidence).toMatchObject({
      status: "completed",
      findings: [
        {
          status: "completed",
          agent: "ui-vibe-specialist",
          result: "The specialist found grounded evidence.",
        },
      ],
    });
  });

  it("keeps issue comments readable when Kody answers a self-routed follow-up", async () => {
    listResolvedAgentFilesMock.mockResolvedValueOnce([
      {
        slug: "kody",
        title: "Kody",
        body: "Coordinates assigned specialists.",
        subagents: ["operations-specialist"],
        updatedAt: "",
        htmlUrl: "",
      },
      {
        slug: "operations-specialist",
        title: "Operations Specialist",
        body: "Handles tasks, runs, and operational status.",
        capabilities: ["builtin-agent-operations-specialist"],
        updatedAt: "",
        htmlUrl: "",
      },
    ]);

    const { status, tools } = await postAndCaptureToolNames(
      "why u have made 2 comments?",
    );

    expect(status).toBe(200);
    expect(tools).toHaveProperty("github_get_issue");
  });

  it("continues the chat when optional CMS tools cannot be loaded", async () => {
    createCmsToolsMock.mockRejectedValueOnce(
      new Error("CMS config unavailable"),
    );
    nextUiMessageChunks = [
      { type: "text-start", id: "reply" },
      { type: "text-delta", id: "reply", delta: "Still responding." },
      { type: "text-end", id: "reply" },
    ];

    const { status, toolNames, response } = await postAndCaptureToolNames();

    expect(status).toBe(200);
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).not.toContain("cms_list_collections");
    expect(await response.text()).toContain("Still responding.");
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

  it("gives a signed-in Kody user full personal Chat without GitHub", async () => {
    setChatRequestContextProvider({
      resolveUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
    });

    const before = streamTextCalls.length;
    const response = await kodyChatPOST(makePersonalRequest());
    const tools = (streamTextCalls[before]?.tools ?? {}) as Record<
      string,
      unknown
    >;

    expect(response.status).toBe(200);
    expect(tools).toEqual(
      expect.objectContaining({
        list_commands: expect.any(Object),
        read_instructions: expect.any(Object),
        list_secret_names: expect.any(Object),
        list_memories: expect.any(Object),
        guided_flow_start: expect.any(Object),
        show_view: expect.any(Object),
      }),
    );
    expect(tools).not.toHaveProperty("github_get_file");
    expect(tools).not.toHaveProperty("list_workflows");
    expect(tools).not.toHaveProperty("list_todos");
  });

  it("keeps Kody account identity when repository access is also present", async () => {
    setChatRequestContextProvider({
      resolveUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
    });
    const actorChecksBefore = verifyActorLoginMock.mock.calls.length;
    const request = new NextRequest("https://dash.test/api/kody/chat/kody", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "ghp_test",
        "x-kody-owner": "owner",
        "x-kody-repo": "repo",
      },
      body: JSON.stringify({
        actorLogin: "different-github-login",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const response = await kodyChatPOST(request);

    expect(response.status, await response.clone().text()).toBe(200);
    expect(verifyActorLoginMock).toHaveBeenCalledTimes(actorChecksBefore + 1);
    expect(verifyActorLoginMock.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it("exposes connected repositories and the cross-repository capability tools", async () => {
    setChatRequestContextProvider({
      resolveUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
      resolveRepositories: vi.fn(async () => [
        {
          owner: "owner",
          repo: "source",
          token: "source-token",
          actorGithubId: 1,
        },
        {
          owner: "owner",
          repo: "repo",
          token: "target-token",
          actorGithubId: 1,
        },
      ]),
    });

    const before = streamTextCalls.length;
    const response = await kodyChatPOST(
      makeRequest("Copy prepare-facebook-post from owner/source to owner/repo"),
    );
    const call = streamTextCalls[before] ?? {};
    const tools = (call.tools ?? {}) as Record<string, unknown>;

    expect(response.status, await response.clone().text()).toBe(200);
    expect(tools).toEqual(
      expect.objectContaining({
        list_connected_repositories: expect.any(Object),
        read_connected_capability: expect.any(Object),
        copy_capability: expect.any(Object),
      }),
    );
    expect(call.system).toContain("## Connected repositories");
    expect(call.system).toContain("owner/source");
    expect(call.system).toContain("owner/repo (current)");
    expect(call.system).not.toContain("source-token");
    expect(call.system).not.toContain("target-token");
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
    await expect(fixtureTool.execute({ message: 42 }, {})).resolves.toEqual({
      error: expect.stringContaining("Invalid input"),
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
