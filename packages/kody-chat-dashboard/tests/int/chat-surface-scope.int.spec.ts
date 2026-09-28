/**
 * @fileoverview Integration tests for server-side surface scoping
 *   (phase 2 step 6) across the three chat backends.
 * @testFramework vitest
 * @domain chat-platform
 *
 * Covers: the kody in-process route accepts a surface ticket in place of a
 * PAT and serves a RESTRICTED tool set (strict subset of the admin set —
 * no repo/admin tools ever reach the model); the trigger and brain routes
 * reject ticket-only requests with 403; and unauthenticated requests still
 * 401 exactly as before (admin behavior unchanged — existing int specs
 * assert the full admin path byte-for-byte).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const h = vi.hoisted(() => ({
  resolveChatModel: vi.fn(),
  resolveBackgroundToken: vi.fn(),
  resolveClientBrand: vi.fn(),
  loadRelevantMemoryForPrompt: vi.fn(),
  loadInstructionsForPrompt: vi.fn(),
  loadContextForPrompt: vi.fn(),
  loadViewRendererContextForPrompt: vi.fn(),
  listResolvedAgentFiles: vi.fn(),
  getEngineConfig: vi.fn(),
}));
vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: h.resolveChatModel,
}));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: h.resolveBackgroundToken,
}));
vi.mock("../../src/dashboard/lib/client-brand", () => ({
  resolveClientBrand: h.resolveClientBrand,
}));
vi.mock("../../src/dashboard/lib/chat-defaults", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/dashboard/lib/chat-defaults")
    >();
  return {
    ...actual,
    loadChatDefaults: vi.fn(async () => ({
      agentIdentity: "You are a test assistant.",
      capability: { slug: "kody-chat", title: "Chat", body: "", tools: [] },
      workflows: [],
      skills: {},
    })),
  };
});
vi.mock("@kody-ade/workspace/memory", () => ({
  loadRelevantMemoryForPrompt: h.loadRelevantMemoryForPrompt,
  createMemoryRuntime: vi.fn(),
}));
vi.mock("@kody-ade/workspace/instructions/files", () => ({
  loadInstructionsForPrompt: h.loadInstructionsForPrompt,
}));
vi.mock("@kody-ade/workspace/context/files", () => ({
  loadContextForPrompt: h.loadContextForPrompt,
}));
vi.mock(
  "../../src/dashboard/lib/view-renderers/standalone-renderer-store",
  () => ({
    loadViewRendererContextForPrompt: h.loadViewRendererContextForPrompt,
  }),
);
vi.mock("../../src/dashboard/lib/agent-files", () => ({
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  listResolvedAgentFiles: h.listResolvedAgentFiles,
}));
vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  readOperators: vi.fn(async () => ({ operators: [] })),
  writeOperators: vi.fn(),
  writeConfigPatch: vi.fn(),
}));

import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route";
import { POST as triggerPOST } from "../../app/api/kody/chat/trigger/route";
import { POST as brainPOST } from "../../app/api/kody/chat/brain/route";
import {
  CLIENT_SURFACE_TOOL_ALLOWLIST,
  mintClientSurfaceTicket,
  SURFACE_TICKET_HEADER,
} from "../../src/dashboard/lib/chat/platform/surface-scope";
import {
  CHAT_OUTPUT_TOOL_NAMES,
  FINAL_ANSWER_TOOL,
} from "../../src/dashboard/lib/chat-output-tools";

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "surface-scope-int-test-secret";
});

beforeEach(() => {
  vi.clearAllMocks();
  h.loadRelevantMemoryForPrompt.mockResolvedValue(null);
  h.loadInstructionsForPrompt.mockResolvedValue(null);
  h.loadContextForPrompt.mockResolvedValue(null);
  h.loadViewRendererContextForPrompt.mockResolvedValue({
    rules: null,
    definitions: [],
  });
  h.listResolvedAgentFiles.mockResolvedValue([
    {
      slug: "support-agent",
      title: "Support Agent",
      body: "You answer as support.",
      updatedAt: "",
      htmlUrl: "",
    },
  ]);
  h.getEngineConfig.mockResolvedValue({ config: {} });
});

function ticketHeaders(): Record<string, string> {
  const { ticket } = mintClientSurfaceTicket({
    brandSlug: "acme",
    owner: "acme-co",
    repo: "widgets",
  });
  return { [SURFACE_TICKET_HEADER]: ticket };
}

function makeRequest(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(`https://dash.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const chatBody = { messages: [{ role: "user", content: "hi" }] };

function mockModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: FINAL_ANSWER_TOOL,
            input: JSON.stringify({
              content: "Hello. What would you like help with next?",
            }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
}

describe("surface scoping — kody in-process route", () => {
  it("accepts a ticket-only request and restricts the tool set", async () => {
    const model = mockModel();
    h.resolveBackgroundToken.mockResolvedValue({
      token: "ghs_installation",
      source: "app",
    });
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      modelId: "brand-model",
      agentSlug: "support-agent",
    });
    h.resolveChatModel.mockResolvedValue({
      model,
      resolvedModel: {
        id: "mock/model",
        provider: "mock",
        modelName: "mock-model",
      },
    });

    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(200);
    // Drain the stream so onFinish/cleanup runs.
    await res.text();

    expect(h.resolveBackgroundToken).toHaveBeenCalledWith("acme-co", "widgets");

    expect(h.resolveChatModel).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "brand-model",
      expect.any(Object),
    );
    expect(h.listResolvedAgentFiles).toHaveBeenCalledOnce();
    const modelInput = JSON.stringify(model.doStreamCalls[0]);
    expect(modelInput).toContain(
      "The assistant speaker for this turn is Support Agent",
    );
    expect(modelInput).toContain("You answer as support.");

    const sentTools = (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
    expect(sentTools.length).toBeGreaterThan(0);
    // Every tool the model saw is either chat protocol or in the allowlist.
    const allowed = new Set<string>([
      ...CLIENT_SURFACE_TOOL_ALLOWLIST,
      ...CHAT_OUTPUT_TOOL_NAMES,
    ]);
    for (const name of sentTools) {
      expect(allowed.has(name), `unexpected surface tool: ${name}`).toBe(true);
    }
    // Strict subset of the admin set: admin-only tools must be absent.
    for (const forbidden of [
      "create_task",
      "get_secret",
      "set_secret",
      "switch_agent",
      "kody_run_issue",
      "list_workflow_runs",
    ]) {
      expect(sentTools).not.toContain(forbidden);
    }
  });

  it("keeps prior-agent conversation as context, not active assistant history", async () => {
    const model = mockModel();
    h.resolveBackgroundToken.mockResolvedValue({
      token: "ghs_installation",
      source: "app",
    });
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      modelId: "brand-model",
      agentSlug: "support-agent",
    });
    h.resolveChatModel.mockResolvedValue({
      model,
      resolvedModel: {
        id: "mock/model",
        provider: "mock",
        modelName: "mock-model",
      },
    });

    const res = await kodyChatPOST(
      makeRequest(
        "/api/kody/chat/kody",
        {
          messages: [{ role: "user", content: "Who are you now?" }],
          agentHandoff: {
            fromSlug: "kody",
            fromTitle: "Kody",
            toSlug: "support-agent",
            toTitle: "Support Agent",
            switchedAt: "2026-07-20T10:00:00.000Z",
          },
          agentHandoffContext:
            "User: Who are you?\n\nPrevious agent: I am Kody.",
        },
        ticketHeaders(),
      ),
    );
    expect(res.status).toBe(200);
    await res.text();

    const modelCall = model.doStreamCalls[0];
    expect(modelCall?.prompt.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    const modelInput = JSON.stringify(modelCall);
    expect(modelInput).toContain("Who are you now?");
    expect(modelInput).not.toContain('"role":"assistant"');
    expect(modelInput).toContain(
      "not the current assistant's message history or identity",
    );
    expect(modelInput).toContain("Previous agent: I am Kody.");
    expect(modelInput).toContain(
      "The assistant speaker for this turn is Support Agent",
    );
  });

  it("fails closed before model execution when the selected agent is unavailable", async () => {
    const model = mockModel();
    h.resolveBackgroundToken.mockResolvedValue({
      token: "ghs_installation",
      source: "app",
    });
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      modelId: "brand-model",
      agentSlug: "missing-agent",
    });
    h.resolveChatModel.mockResolvedValue({
      model,
      resolvedModel: {
        id: "mock/model",
        provider: "mock",
        modelName: "mock-model",
      },
    });
    h.listResolvedAgentFiles.mockResolvedValue([]);

    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, ticketHeaders()),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "agent_not_found" });
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("uses the built-in Kody identity without consulting the external agent catalog", async () => {
    const model = mockModel();
    h.resolveBackgroundToken.mockResolvedValue({
      token: "ghs_installation",
      source: "app",
    });
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      modelId: "brand-model",
      agentSlug: "kody",
    });
    h.resolveChatModel.mockResolvedValue({
      model,
      resolvedModel: {
        id: "mock/model",
        provider: "mock",
        modelName: "mock-model",
      },
    });
    h.listResolvedAgentFiles.mockResolvedValue([]);

    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, ticketHeaders()),
    );

    expect(res.status).toBe(200);
    await res.text();
    expect(h.listResolvedAgentFiles).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("keeps required-view gating alive on client-surface turns via builtin renderers (regression: brand chat never rendered cards)", async () => {
    const model = mockModel();
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      agentSlug: "support-agent",
    });
    h.resolveChatModel.mockResolvedValue({
      model,
      resolvedModel: {
        id: "mock/model",
        provider: "mock",
        modelName: "mock-model",
        toolChoice: { required: true, named: true },
      },
    });

    const res = await kodyChatPOST(
      makeRequest(
        "/api/kody/chat/kody",
        {
          messages: [
            {
              role: "user",
              content: "aske me a q and ask for approval to confirm it",
            },
          ],
        },
        ticketHeaders(),
      ),
    );

    expect(res.status).toBe(200);
    await res.text();
    // The first step must pin show_view — that only happens when the
    // builtin renderer definitions back the client-surface turn.
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({
      type: "tool",
      toolName: "show_view",
    });
  });

  it("still 401s with neither PAT nor ticket (unchanged)", async () => {
    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, {}),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(String(data.message)).toContain("x-kody-token");
  });

  it("401s on an invalid ticket (falls through to today's auth)", async () => {
    const res = await kodyChatPOST(
      makeRequest("/api/kody/chat/kody", chatBody, {
        [SURFACE_TICKET_HEADER]: "garbage",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("surface scoping — admin-only backends reject tickets", () => {
  it("trigger: 403 surface_scope_forbidden on a ticket-only request", async () => {
    const res = await triggerPOST(
      makeRequest("/api/kody/chat/trigger", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("surface_scope_forbidden");
  });

  it("trigger: still 401 with no credentials at all (unchanged)", async () => {
    const res = await triggerPOST(
      makeRequest("/api/kody/chat/trigger", chatBody, {}),
    );
    expect(res.status).toBe(401);
  });

  it("brain: 403 surface_scope_forbidden on a ticket-only request", async () => {
    const res = await brainPOST(
      makeRequest("/api/kody/chat/brain", chatBody, ticketHeaders()),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("surface_scope_forbidden");
  });

  it("brain: still 401 with no credentials at all (unchanged)", async () => {
    const res = await brainPOST(
      makeRequest("/api/kody/chat/brain", chatBody, {}),
    );
    expect(res.status).toBe(401);
  });
});
