/**
 * @fileoverview Route-level regression test for preview-context issue creation.
 * @testFramework vitest
 * @domain chat-contract
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RENDER_VIEW_DIRECTIVE } from "@dashboard/lib/chat-ui-actions";

const streamTextMock = vi.hoisted(() => vi.fn());
const createUIMessageStreamResponseMock = vi.hoisted(() => vi.fn());
const loadViewRendererContextForPromptMock = vi.hoisted(() => vi.fn());
const loadInstructionsForPromptMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown, options?: unknown) => ({
    jsonSchema: schema,
    ...(options && typeof options === "object" ? options : {}),
  }),
  streamText: streamTextMock,
  stepCountIs: vi.fn(() => vi.fn()),
  createUIMessageStream: vi.fn((config: unknown) => config),
  createUIMessageStreamResponse: createUIMessageStreamResponseMock,
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    storeRepoUrl: undefined,
    storeRef: undefined,
  })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "alice" } })),
  getUserOctokit: vi.fn(async () => ({})),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user_alice" })),
}));

vi.mock(
  "../../../../packages/kody-chat-dashboard/src/dashboard/lib/github-client",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../packages/kody-chat-dashboard/src/dashboard/lib/github-client")
      >();
    return {
      ...actual,
      createUserOctokit: vi.fn(() => ({})),
      setGitHubContext: vi.fn(),
      clearGitHubContext: vi.fn(),
    };
  },
);

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
  "../../../../packages/kody-chat-dashboard/src/dashboard/lib/view-renderers/standalone-renderer-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../packages/kody-chat-dashboard/src/dashboard/lib/view-renderers/standalone-renderer-store")
      >();
    return {
      ...actual,
      loadViewRendererContextForPrompt: loadViewRendererContextForPromptMock,
    };
  },
);

vi.mock(
  "../../../../packages/kody-chat-dashboard/app/api/kody/chat/resolve-model",
  () => ({
    resolveChatModel: vi.fn(async () => ({
      model: { modelId: "test-model" },
      apiKey: "test-key",
      resolvedModel: {
        id: "test-model",
        label: "Test model",
        provider: "openai",
        protocol: "openai-compatible",
        baseURL: "https://models.test/v1",
        modelName: "test-model",
        apiKeySecret: "TEST_MODEL_API_KEY",
        enabled: true,
        default: true,
      },
    })),
  }),
);

vi.mock(
  "../../../../packages/kody-chat-dashboard/app/api/kody/chat/tools/cms-tools",
  () => ({
    createCmsTools: vi.fn(async () => ({})),
  }),
);

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
      consumeStream: vi.fn(async () => undefined),
      toUIMessageStream: vi.fn(() => ({})),
    });
    loadInstructionsForPromptMock.mockResolvedValue(null);
    createUIMessageStreamResponseMock.mockReturnValue(
      new Response("ok", { status: 200 }),
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
                  items?: {
                    properties?: { type?: { enum?: string[] } };
                  };
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
      showView?.inputSchema?.jsonSchema?.properties?.elements
        ?.items?.properties?.type?.enum,
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
});
