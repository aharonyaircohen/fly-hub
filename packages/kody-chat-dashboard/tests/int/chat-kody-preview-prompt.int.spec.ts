/**
 * @fileoverview Route-level regression test for preview-context issue creation.
 * @testFramework vitest
 * @domain chat-contract
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RENDER_VIEW_DIRECTIVE } from "../../src/dashboard/lib/chat-ui-actions";
import {
  CHAT_OUTPUT_CONTRACT_DATA_TYPE,
  EXCLUSIVE_TOOL_OUTPUT_MODE,
} from "../../src/dashboard/lib/chat-output-tools";

const streamTextMock = vi.hoisted(() => vi.fn());
const toUIMessageStreamMock = vi.hoisted(() =>
  vi.fn((_options?: unknown) => ({})),
);
const createUIMessageStreamMock = vi.hoisted(() => vi.fn());
const createUIMessageStreamResponseMock = vi.hoisted(() => vi.fn());
const loadViewRendererContextForPromptMock = vi.hoisted(() => vi.fn());
const loadInstructionsForPromptMock = vi.hoisted(() => vi.fn());
const createCmsToolsMock = vi.hoisted(() => vi.fn());
const startDurableTurnMock = vi.hoisted(() => vi.fn());
const resolvedModelMock = vi.hoisted(() => ({
  id: "test-model",
  label: "Test model",
  provider: "openai",
  protocol: "openai-compatible",
  baseURL: "https://models.test/v1",
  modelName: "test-model",
  apiKeySecret: "TEST_MODEL_API_KEY",
  enabled: true,
  default: true,
  maxSteps: 8,
}));

vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown, options?: unknown) => ({
    jsonSchema: schema,
    ...(options && typeof options === "object" ? options : {}),
  }),
  streamText: streamTextMock,
  stepCountIs: vi.fn(() => vi.fn()),
  createUIMessageStream: createUIMessageStreamMock,
  createUIMessageStreamResponse: createUIMessageStreamResponseMock,
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  requireUserAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    storeRepoUrl: undefined,
    storeRef: undefined,
  })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", githubId: 1 },
  })),
  getUserOctokit: vi.fn(async () => ({})),
}));

vi.mock("../../src/dashboard/lib/github-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/dashboard/lib/github-client")
    >();
  return {
    ...actual,
    createUserOctokit: vi.fn(() => ({})),
    setGitHubContext: vi.fn(),
    clearGitHubContext: vi.fn(),
  };
});

vi.mock("@kody-ade/workspace/memory", () => ({
  loadRelevantMemoryForPrompt: vi.fn(async () => null),
  createMemoryRuntime: vi.fn(),
}));

vi.mock("@kody-ade/workspace/instructions/files", () => ({
  loadInstructionsForPrompt: loadInstructionsForPromptMock,
}));

vi.mock("@kody-ade/workspace/context/files", () => ({
  loadContextForPrompt: vi.fn(async () => null),
}));

vi.mock(
  "../../src/dashboard/lib/view-renderers/standalone-renderer-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/dashboard/lib/view-renderers/standalone-renderer-store")
      >();
    return {
      ...actual,
      loadViewRendererContextForPrompt: loadViewRendererContextForPromptMock,
    };
  },
);

vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: vi.fn(async () => ({
    model: { modelId: "test-model" },
    apiKey: "test-key",
    resolvedModel: { ...resolvedModelMock },
  })),
}));

vi.mock("../../app/api/kody/chat/tools/cms-tools", () => ({
  createCmsTools: createCmsToolsMock,
}));

vi.mock("../../app/api/kody/chat/durable-turn", () => ({
  startDurableTurn: startDurableTurnMock,
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "app",
    },
    body: JSON.stringify(body),
  });
}

const approvalRendererDefinition = {
  slug: "approval-card",
  name: "Approval Card",
  purpose: "approval-card",
  rule: "Use this purpose when Kody asks the user for approval.",
  data: {
    title: { type: "text", description: "Short approval question." },
    body: { type: "text", optional: true },
    actions: { type: "actions", optional: true },
  },
  defaults: {
    actions: [
      {
        id: "approve",
        label: "Approve",
        response: "approve",
        variant: "primary",
      },
      { id: "cancel", label: "Cancel", response: "cancel" },
    ],
  },
  type: "layout",
  ui: {
    type: "stack",
    children: [
      { type: "text", value: "$title", variant: "title" },
      { type: "text", value: "$body" },
      {
        type: "row",
        for: "$actions",
        as: "action",
        item: { type: "button", label: "$action.label", action: "$action" },
      },
    ],
  },
} as const;

describe("POST /api/kody/chat/kody preview prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(resolvedModelMock, {
      provider: "openai",
      modelName: "test-model",
      toolChoice: undefined,
    });
    process.env.KODY_MASTER_KEY = "kody-direct-test-secret";
    loadViewRendererContextForPromptMock.mockResolvedValue({
      rules:
        "- Purpose `approval-card`: Use this purpose when Kody asks the user for approval.\n" +
        "  Data keys:\n" +
        "  - title (text): Short approval question.\n" +
        "  - body (text, optional)\n" +
        "  - actions (actions, default available, optional)",
      definitions: [approvalRendererDefinition],
    });
    streamTextMock.mockReturnValue({
      toUIMessageStream: toUIMessageStreamMock,
      consumeStream: vi.fn(() => Promise.resolve()),
    });
    createUIMessageStreamMock.mockImplementation((config: unknown) => config);
    loadInstructionsForPromptMock.mockResolvedValue(null);
    createCmsToolsMock.mockResolvedValue({});
    createUIMessageStreamResponseMock.mockReturnValue(
      new Response("ok", { status: 200 }),
    );
    startDurableTurnMock.mockReturnValue({
      started: Promise.resolve(),
      recordProgress: vi.fn(),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    });
  });

  it("sends live reasoning and tool activity to the durable turn", async () => {
    const recordProgress = vi.fn();
    startDurableTurnMock.mockReturnValueOnce({
      started: Promise.resolve(),
      recordProgress,
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    });
    streamTextMock.mockImplementationOnce((options) => ({
      toUIMessageStream: toUIMessageStreamMock,
      consumeStream: vi.fn(async () => {
        options.onChunk?.({
          chunk: {
            type: "reasoning-delta",
            id: "reasoning-1",
            text: "Checking",
          },
        });
        const toolCall = {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "read_file",
          input: { path: "README.md" },
        };
        options.onChunk?.({ chunk: toolCall });
        options.onChunk?.({
          chunk: {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "README.md" },
            output: { content: "read" },
          },
        });
      }),
    }));

    const { POST } = await import("../../app/api/kody/chat/kody/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "check the repository" }],
        actorLogin: "alice",
        conversationId: "conversation-1",
        turnId: "turn-1",
        conversationAgent: { slug: "kody", title: "Kody" },
      }),
    );

    await vi.waitFor(() =>
      expect(recordProgress).toHaveBeenLastCalledWith({
        reasoning: "Checking",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            arguments: { path: "README.md" },
            status: "success",
          },
        ],
      }),
    );
  });

  it("surfaces the provider error and trace id in the model UI stream", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "plan this change" }],
      }),
    );

    expect(res.status).toBe(200);
    const streamConfig = createUIMessageStreamMock.mock.calls[0]?.[0] as {
      execute: (args: {
        writer: {
          write: (value: unknown) => void;
          merge: (value: unknown) => void;
        };
      }) => Promise<void>;
    };
    await streamConfig.execute({
      writer: { write: vi.fn(), merge: vi.fn() },
    });
    const streamOptions = toUIMessageStreamMock.mock.calls[0]?.[0] as
      { onError?: (error: unknown) => string } | undefined;
    expect(streamOptions?.onError).toBeTypeOf("function");
    expect(streamOptions?.onError?.(new Error("provider unavailable"))).toMatch(
      /^\[trace [a-f0-9]+\] provider unavailable$/,
    );
  });

  it("declares exclusive output-tool ownership for a required-tool provider before model chunks", async () => {
    Object.assign(resolvedModelMock, { toolChoice: { required: true } });
    const { POST } = await import("../../app/api/kody/chat/kody/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "plan this change" }],
      }),
    );

    const streamConfig = createUIMessageStreamMock.mock.calls[0]?.[0] as {
      execute: (args: {
        writer: {
          write: (value: unknown) => void;
          merge: (value: unknown) => void;
        };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await streamConfig.execute({ writer });

    expect(writer.write).toHaveBeenCalledWith({
      type: CHAT_OUTPUT_CONTRACT_DATA_TYPE,
      data: { mode: EXCLUSIVE_TOOL_OUTPUT_MODE },
    });
  });

  it("hides and retries approval prose when the provider cannot force show_view", async () => {
    Object.assign(resolvedModelMock, {
      provider: "minimax",
      modelName: "MiniMax-M3",
    });
    streamTextMock
      .mockReturnValueOnce({
        toUIMessageStream: toUIMessageStreamMock,
        consumeStream: vi.fn(() => Promise.resolve()),
        steps: Promise.resolve([
          { toolResults: [], text: "Do you approve this plan?" },
        ]),
      })
      .mockReturnValueOnce({
        toUIMessageStream: toUIMessageStreamMock,
        consumeStream: vi.fn(() => Promise.resolve()),
        steps: Promise.resolve([
          {
            text: "",
            toolResults: [
              {
                toolName: "show_view",
                output: {
                  action: RENDER_VIEW_DIRECTIVE,
                  view: "renderer",
                  rendererSlug: "approval-card",
                  rendererName: "Approval Card",
                  data: { title: "Approve this plan?" },
                  ui: { type: "stack", children: [] },
                },
              },
            ],
          },
        ]),
      });

    const { POST } = await import("../../app/api/kody/chat/kody/route");
    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "Ask me to approve this plan before creating the agents.",
          },
        ],
      }),
    );

    const streamConfig = createUIMessageStreamMock.mock.calls[0]?.[0] as {
      execute: (args: {
        writer: {
          write: (value: unknown) => void;
          merge: (value: unknown) => void;
        };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await streamConfig.execute({ writer });

    expect(writer.write).toHaveBeenCalledWith({
      type: CHAT_OUTPUT_CONTRACT_DATA_TYPE,
      data: { mode: EXCLUSIVE_TOOL_OUTPUT_MODE },
    });
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]?.system).toContain(
      "Call `show_view` NOW",
    );
  });

  it("renders explicit recovery choices after the selected model exhausts renderer retries", async () => {
    Object.assign(resolvedModelMock, {
      id: "selected/model",
      label: "Selected model",
      provider: "custom",
      modelName: "selected-model",
    });
    streamTextMock.mockImplementation(() => ({
      toUIMessageStream: toUIMessageStreamMock,
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        { toolResults: [], text: "Do you approve this plan?" },
      ]),
    }));

    const { POST } = await import("../../app/api/kody/chat/kody/route");
    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "Ask me to approve this plan before creating the agents.",
          },
        ],
      }),
    );

    const streamConfig = createUIMessageStreamMock.mock.calls[0]?.[0] as {
      execute: (args: {
        writer: {
          write: (value: unknown) => void;
          merge: (value: unknown) => void;
        };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await streamConfig.execute({ writer });

    expect(streamTextMock).toHaveBeenCalledTimes(3);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool-output-available",
        output: {
          content: "Do you approve this plan?\n\nWould you like me to retry?",
        },
      }),
    );
  });

  it("keeps an optional CMS load failure out of the user-visible error stream", async () => {
    createCmsToolsMock.mockRejectedValueOnce(new Error("GitHub unavailable"));
    const { POST } = await import("../../app/api/kody/chat/kody/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "what is this project?" }],
      }),
    );

    const streamConfig = createUIMessageStreamMock.mock.calls[0]?.[0] as {
      execute: (args: {
        writer: {
          write: (value: unknown) => void;
          merge: (value: unknown) => void;
        };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await streamConfig.execute({ writer });

    expect(writer.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
    expect(writer.merge).toHaveBeenCalledTimes(1);
    expect(streamTextMock.mock.calls[0]?.[0]?.system).toContain(
      "Tool families UNAVAILABLE this turn (their configuration failed to load): cms.",
    );
  });

  it("sends preview make-page instructions in the actual model system prompt", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "make this page" }],
        previewContext:
          "[Preview context]\n- Source path: views/demo-123\n- Preview URL: /api/kody/views/demo-123/index.html",
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(
      streamTextMock.mock.results[0]?.value.consumeStream,
    ).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0]?.[0]?.system;
    expect(system).toContain("## Current preview reference");
    expect(system).toContain('"make this page"');
    expect(system).toContain("create a GitHub issue");
    expect(system).toContain("Do not answer with a fresh design direction");
    expect(system).toContain("Source path: views/demo-123");
  });

  it("keeps repo PM-style instructions after the generic safety reminders", async () => {
    loadInstructionsForPromptMock.mockResolvedValue(
      "write short not technical answers, operator is a PM",
    );
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "what is wrong here?" }],
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0]?.[0]?.system;
    expect(system).toContain("## Critical reminders");
    expect(system).toContain("## User instructions for this repo");
    expect(system.indexOf("## Critical reminders")).toBeLessThan(
      system.indexOf("## User instructions for this repo"),
    );
    expect(system).toContain(
      "write short not technical answers, operator is a PM",
    );
    expect(system).toContain(
      "For a PM, founder, or non-technical operator, lead with the business or product effect",
    );
  });

  it("keeps route instructions in the top-level system prompt", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "ask me a question and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const options = streamTextMock.mock.calls[0]?.[0];
    expect(options?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "system" })]),
    );
    expect(options?.system).toContain("finish this turn with `show_view`");
  });

  it("keeps should-we-add architecture advice on the text-answer path", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "Should this project add another chat system?",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const options = streamTextMock.mock.calls[0]?.[0];
    expect(options?.system).not.toContain(
      "The latest user message asks for an interactive response",
    );
    expect(options?.system).toContain(
      "This is an architecture recommendation, not a request to create anything and not a question about configured chat models",
    );
    expect(options?.system).toContain(
      "Give a direct verdict instead of an inventory or clarification question",
    );
    const step = options?.prepareStep?.({ steps: [] } as never);
    expect(step?.activeTools).toContain("final_answer");
    expect(step?.toolChoice).not.toEqual({
      type: "tool",
      toolName: "show_view",
    });
  });

  it("reserves the last model step for a prose answer with a follow-up", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "How does Kody Chat work in this project?",
          },
        ],
      }),
    );

    const options = streamTextMock.mock.calls[0]?.[0];
    const prepared = options?.prepareStep?.({
      steps: Array.from({ length: 7 }, () => ({
        toolResults: [
          { toolName: "read_file", output: { content: "verified" } },
        ],
      })),
    } as never);

    expect(prepared?.activeTools).toEqual(["final_answer"]);
    expect(prepared?.system).toContain("Stop researching");
    expect(prepared?.system).toContain("follow-up question");
  });

  it("exposes a working show_view spec contract for approval renderer requests", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const options = streamTextMock.mock.calls[0]?.[0];
    const showView = options?.tools?.show_view as
      | {
          description?: string;
          inputSchema?: {
            jsonSchema?: {
              required?: string[];
              properties?: {
                elements?: {
                  items?: { properties?: { type?: { enum?: string[] } } };
                };
              };
            };
          };
          execute?: (input: Record<string, unknown>) => Promise<unknown>;
        }
      | undefined;

    expect(showView?.description).toContain("Spec format");
    expect(showView?.description).toContain("ApprovalCard");
    expect(showView?.inputSchema?.jsonSchema?.required).toEqual([
      "root",
      "elements",
    ]);
    expect(
      showView?.inputSchema?.jsonSchema?.properties?.elements?.items?.properties
        ?.type?.enum,
    ).toEqual(expect.arrayContaining(["ApprovalCard", "Stack", "Button"]));
    expect(showView?.execute).toBeTypeOf("function");

    const output = await showView?.execute?.({
      root: "card",
      elements: {
        card: {
          type: "ApprovalCard",
          props: {
            title: "Confirm this question?",
            body: "Should I continue?",
          },
        },
      },
    });

    expect(output).toMatchObject({
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      rendererSlug: "approval-card",
      ui: expect.objectContaining({
        type: "stack",
        children: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            value: "Confirm this question?",
            variant: "title",
          }),
        ]),
      }),
    });
  });

  it("does not install arg-repair heuristics and surfaces spec errors to the model", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const options = streamTextMock.mock.calls[0]?.[0];
    // The old pipeline scraped prose into renderer data via
    // experimental_repairToolCall; the spec contract must not.
    expect(options?.experimental_repairToolCall).toBeUndefined();

    const showView = options?.tools?.show_view as
      | {
          execute?: (
            input: Record<string, unknown>,
          ) => Promise<{ error?: string }>;
        }
      | undefined;
    const output = await showView?.execute?.({});

    expect(output).toMatchObject({
      error: expect.stringContaining("root"),
    });
  });

  it("retries up to twice in the same stream when a required-view turn stays silent", async () => {
    const silentResult = () => ({
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        { toolResults: [], text: "<think>planning only, no call</think>" },
      ]),
    });
    streamTextMock
      .mockReturnValueOnce(silentResult())
      .mockReturnValueOnce(silentResult())
      .mockReturnValueOnce(silentResult());
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await stream.execute({ writer });

    // Two corrective re-runs after the silent original, then give up.
    expect(streamTextMock).toHaveBeenCalledTimes(3);
    const retryMessages = streamTextMock.mock.calls[1]?.[0]?.messages;
    const retrySystem = streamTextMock.mock.calls[1]?.[0]?.system;
    expect(retryMessages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "system" })]),
    );
    expect(retrySystem).toContain("Call `show_view` NOW");
    expect(writer.merge).toHaveBeenCalledTimes(3);
  });

  it("returns a question-ending recovery when a prose model never calls final_answer", async () => {
    const silentResult = () => ({
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        { toolResults: [], text: "<think>answer stayed in reasoning</think>" },
      ]),
    });
    streamTextMock
      .mockReturnValueOnce(silentResult())
      .mockReturnValueOnce(silentResult())
      .mockReturnValueOnce(silentResult());
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [{ role: "user", content: "What is 2 + 2?" }],
      }),
    );

    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await stream.execute({ writer });

    expect(streamTextMock).toHaveBeenCalledTimes(3);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({
          content: expect.stringMatching(/\?$/),
        }),
      }),
    );
  });

  it("carries successful tool results into a silent-turn retry", async () => {
    const completedToolMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "read-package",
            toolName: "github_get_file",
            input: { path: "package.json" },
          },
          {
            type: "tool-call",
            toolCallId: "read-issue",
            toolName: "github_get_issue",
            input: { issueNumber: 119 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "read-package",
            toolName: "github_get_file",
            output: { type: "json", value: { name: "kody-monorepo" } },
          },
          {
            type: "tool-result",
            toolCallId: "read-issue",
            toolName: "github_get_issue",
            output: {
              type: "json",
              value: { title: "Repository file question" },
            },
          },
        ],
      },
    ];
    const firstResult = {
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [
            { toolName: "github_get_file", output: { name: "kody-monorepo" } },
            {
              toolName: "github_get_issue",
              output: { title: "Repository file question" },
            },
          ],
          text: "<think>I have the answer but did not call final_answer</think>",
        },
      ]),
      response: Promise.resolve({ messages: completedToolMessages }),
    };
    const retryResult = {
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [
            {
              toolName: "final_answer",
              output: { content: "package=kody-monorepo | issue=Repository file question" },
            },
          ],
          text: "",
        },
      ]),
      response: Promise.resolve({ messages: [] }),
    };
    streamTextMock
      .mockReturnValueOnce(firstResult)
      .mockReturnValueOnce(retryResult);
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content:
              "Read package.json and issue #119, then give one combined answer.",
          },
        ],
      }),
    );

    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    await stream.execute({ writer: { write: vi.fn(), merge: vi.fn() } });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]?.messages).toEqual(
      expect.arrayContaining(completedToolMessages),
    );
  });

  it("does not retry when the turn produced a rendered view", async () => {
    const viewResult = {
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [
            { toolName: "show_view", output: { action: "render_view" } },
          ],
          text: "",
        },
      ]),
    };
    streamTextMock.mockReturnValueOnce(viewResult);
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "aske me a q and ask for approval to confirm it",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await stream.execute({ writer });

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(writer.merge).toHaveBeenCalledTimes(1);
  });

  it("corrects a plain-text tool call once with a specific instruction", async () => {
    const malformedResult = () => ({
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [],
          text: "<|tool_call>call:show_view{}",
          reasoningText: "",
        },
      ]),
    });
    const correctedResult = {
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [
            { toolName: "show_view", output: { action: "render_view" } },
          ],
          text: "",
        },
      ]),
    };
    streamTextMock
      .mockReturnValueOnce(malformedResult())
      .mockReturnValueOnce(correctedResult);
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "Ask me to approve this plan.",
          },
        ],
      }),
    );

    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await stream.execute({ writer });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[1]?.[0]?.system).toContain(
      "wrote a tool invocation as PLAIN TEXT",
    );
    expect(writer.merge).toHaveBeenCalledTimes(2);
    expect(writer.write).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({ content: expect.any(String) }),
      }),
    );
  });

  it("stops after one failed plain-text tool-call correction", async () => {
    const malformedResult = () => ({
      toUIMessageStream: vi.fn(() => ({})),
      consumeStream: vi.fn(() => Promise.resolve()),
      steps: Promise.resolve([
        {
          toolResults: [],
          text: "<|tool_call>call:show_view{}",
          reasoningText: "",
        },
      ]),
    });
    streamTextMock
      .mockReturnValueOnce(malformedResult())
      .mockReturnValueOnce(malformedResult());
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [
          {
            role: "user",
            content: "Ask me to approve this plan.",
          },
        ],
      }),
    );

    const stream = createUIMessageStreamResponseMock.mock.calls[0]?.[0]
      ?.stream as {
      execute: (opts: {
        writer: { write: (c: unknown) => void; merge: (s: unknown) => void };
      }) => Promise<void>;
    };
    const writer = { write: vi.fn(), merge: vi.fn() };
    await stream.execute({ writer });

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({ content: expect.any(String) }),
      }),
    );
  });

  it("puts textual tool-call correction in the per-step system prompt for reasoning tokens", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    await POST(
      makeRequest({
        messages: [{ role: "user", content: "look into this bug" }],
      }),
    );

    const options = streamTextMock.mock.calls[0]?.[0];
    const prepareStep = options?.prepareStep as
      | ((input: {
          steps: Array<{
            toolResults: Array<{ toolName: string; output: unknown }>;
            text?: string;
            reasoningText?: string;
          }>;
          messages: Array<{ role: string; content: string }>;
        }) => {
          system?: string;
          messages?: Array<{ role: string; content: string }>;
        })
      | undefined;
    const prepared = prepareStep?.({
      steps: [
        {
          toolResults: [],
          text: "",
          reasoningText: "<|tool_call>call:list_workflows{}",
        },
      ],
      messages: [{ role: "user", content: "look into this bug" }],
    });

    expect(prepared?.messages).toBeUndefined();
    expect(prepared?.system).toContain(
      "Your previous message wrote a tool invocation as PLAIN TEXT",
    );
  });
});
