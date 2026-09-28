/**
 * @fileoverview Transport flow integration — send→stream→persist. Drives
 * the REAL kody-direct and brain adapters against stubbed fetch streams,
 * feeds their ChatEvents through the REAL event-mapping layer
 * (createTransportTurnHandler) into an in-memory message store wired the
 * same way KodyChat wires its session store, and asserts the final
 * message-list shape (content composition, tool chips, pending
 * directives, error bubbles).
 * @testFramework vitest
 * @domain int
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { preparedTurnFixture } from "../fixtures/prepared-turn";
import {
  kodyDirectTransport,
  sendKodyDirectTurn,
} from "../../src/dashboard/lib/chat/core/transports/kody-direct";
import {
  brainTransport,
  sendBrainTurn,
} from "../../src/dashboard/lib/chat/core/transports/brain";
import { runChatTurn } from "../../src/dashboard/lib/chat/core/transports/turn-coordinator";
import {
  createTransportTurnHandler,
  type TransportTurnHandler,
} from "../../src/dashboard/lib/components/kody-chat-transport-events";
import {
  applySettleDecision,
  classifyTurnFailure,
  settleDecision,
} from "../../src/dashboard/lib/components/kody-chat-send";
import type { Message } from "../../src/dashboard/lib/components/kody-chat-types";

/** In-memory stand-in for KodyChat's session-scoped message store. */
function messageStore(seed: Message[]) {
  const store = { messages: seed };
  return {
    store,
    setMessages: (updater: (prev: Message[]) => Message[]) => {
      store.messages = updater(store.messages);
    },
  };
}

/** The two bubbles sendText pushes before any transport work starts. */
function seedTurn(userText: string): Message[] {
  return [
    { role: "user", content: userText, timestamp: "t0" },
    { role: "assistant", content: "", isLoading: true, timestamp: "t1" },
  ];
}

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function installFetch(responses: Response[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("scripted fetch exhausted");
    return next;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function makeHandler(
  setMessages: (updater: (prev: Message[]) => Message[]) => void,
): { handler: TransportTurnHandler; loading: { value: boolean | null } } {
  const loading: { value: boolean | null } = { value: null };
  const handler = createTransportTurnHandler({
    setMessages,
    setLoading: (v) => {
      loading.value = v;
    },
    emitVoiceDelta: null,
    voiceMode: false,
  });
  return { handler, loading };
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  vi.useRealTimers();
});

describe("kody-direct send→stream→persist", () => {
  it("turns a silent stream into a visible retryable error instead of an endless spinner", async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    ) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const { store, setMessages } = messageStore(seedTurn("hello?"));
    const { handler, loading } = makeHandler(setMessages);
    const turn = runChatTurn({
      transport: kodyDirectTransport,
      input: {
        preparedTurn: preparedTurnFixture,
        sessionId: "session-1",
        text: "hello?",
        agentId: "kody",
        context: {
          endpoint: "/api/kody/chat/kody",
          body: { messages: [{ role: "user", content: "hello?" }] },
        },
      },
      context: { authHeaders: {}, emit: handler.handleEvent },
      inactivityMs: 5_000,
    }).catch((error) => {
      applySettleDecision(
        settleDecision("kody-direct", classifyTurnFailure(error)),
        { setMessages, setLoading: (value) => (loading.value = value) },
      );
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await turn;

    expect(loading.value).toBe(false);
    expect(store.messages[1]).toMatchObject({
      role: "assistant",
      isLoading: false,
      isError: true,
      content:
        "Error: Reply stalled after 5 seconds without activity. Please retry.\n\nWould you like me to try again?",
    });
  });

  it("streams reasoning + text + a tool call into the final assistant message", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    restoreFetch = installFetch([
      sseResponse([
        d({ type: "reasoning-delta", delta: "plan the reply" }),
        d({
          type: "data-tools-index",
          data: { github_get_issue: "Read one issue" },
        }),
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "github_get_issue",
          input: { number: 7 },
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { number: 7, title: "Bug" },
        }),
        d({ type: "text-delta", delta: "Issue #7 " }),
        d({ type: "text-delta", delta: "is a bug report." }),
        d({ type: "finish" }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("what is issue 7?"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    // The surface-side settle (what sendText does after send() resolves).
    setMessages((prev) =>
      prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
    );

    expect(store.messages).toHaveLength(2);
    const assistant = store.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.isLoading).toBe(false);
    // Reasoning wrapped for the collapsed panel + the streamed answer.
    expect(assistant.content).toBe(
      "<think>plan the reply</think>\n\nIssue #7 is a bug report.",
    );
    expect(assistant.toolCalls).toEqual([
      {
        id: "c1",
        name: "github_get_issue",
        arguments: { number: 7 },
        status: "success",
        description: "Read one issue",
      },
    ]);
    // No directives, no errors, no created issue.
    expect(handler.state.pendingSwitchAgent).toBeNull();
    expect(handler.state.pendingCreatedIssue).toBeNull();
    expect(handler.state.lastToolErrorText).toBeNull();
  });

  it("never publishes provider draft text before committing a rendered view", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    const renderedView = {
      action: "render_view",
      view: "renderer",
      id: "view-1",
      rendererSlug: "decision-card",
      rendererName: "Decision card",
      resultTarget: "chat",
      ui: {
        type: "stack",
        children: [
          { type: "text", value: "Continue?", variant: "title" },
          {
            type: "button",
            label: "Approve",
            action: {
              id: "approve",
              label: "Approve",
              response: "approve",
            },
          },
        ],
      },
      data: {},
    };
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "data-chat-output-contract",
          data: { mode: "exclusive-tool" },
        }),
        d({ type: "text-delta", delta: "Want me to continue?" }),
        d({
          type: "tool-input-available",
          toolCallId: "view-1",
          toolName: "show_view",
          input: {},
        }),
        d({
          type: "tool-output-available",
          toolCallId: "view-1",
          output: renderedView,
        }),
        d({ type: "finish" }),
      ]),
    ]);

    const { store, setMessages: applyMessages } = messageStore(
      seedTurn("continue?"),
    );
    const snapshots: Message[][] = [];
    const setMessages = (updater: (prev: Message[]) => Message[]) => {
      applyMessages(updater);
      snapshots.push(structuredClone(store.messages));
    };
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(
      snapshots.some((messages) =>
        messages.some((message) =>
          message.content.includes("Want me to continue?"),
        ),
      ),
    ).toBe(false);
    expect(store.messages[1]).toMatchObject({
      role: "assistant",
      content: "",
      view: renderedView,
    });
  });

  it("keeps committed streamed text when a rendered view follows it", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    const renderedView = {
      action: "render_view",
      view: "renderer",
      id: "view-after-text",
      rendererSlug: "decision-card",
      rendererName: "Decision card",
      resultTarget: "chat",
      ui: {
        type: "stack",
        children: [{ type: "text", value: "Choose an option" }],
      },
      data: {},
    };
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "data-chat-output-contract",
          data: { mode: "exclusive-tool" },
        }),
        d({
          type: "tool-input-start",
          toolCallId: "final-before-view",
          toolName: "final_answer",
        }),
        d({
          type: "tool-input-delta",
          toolCallId: "final-before-view",
          inputTextDelta: '{"content":"Here is the context."}',
        }),
        d({
          type: "tool-input-available",
          toolCallId: "final-before-view",
          toolName: "final_answer",
          input: { content: "Here is the context." },
        }),
        d({
          type: "tool-output-available",
          toolCallId: "final-before-view",
          output: { content: "Here is the context." },
        }),
        d({
          type: "tool-input-available",
          toolCallId: "view-after-text",
          toolName: "show_view",
          input: {},
        }),
        d({
          type: "tool-output-available",
          toolCallId: "view-after-text",
          output: renderedView,
        }),
        d({ type: "finish" }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("show both"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(store.messages[1]).toMatchObject({
      role: "assistant",
      content: "Here is the context.",
      view: renderedView,
    });
  });

  it("collects deferred directives and captures created issues without touching the bubble", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    const switchAgent = {
      action: "switch_agent",
      agentId: "kody-live",
      agentName: "Kody Live",
      reason: "hand off",
      autoKickoff: "start working",
    };
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "create_feature",
          input: { title: "Add X" },
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { number: 42, url: "https://github.com/o/r/issues/42" },
        }),
        d({
          type: "tool-input-available",
          toolCallId: "c2",
          toolName: "switch_agent",
          input: {},
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c2",
          output: switchAgent,
        }),
        d({ type: "text-delta", delta: "Created #42, handing off." }),
        d({ type: "finish" }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("build feature X"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    // Directives are pending state for the post-stream code — not UI.
    expect(handler.state.pendingSwitchAgent).toEqual(switchAgent);
    expect(handler.state.pendingCreatedIssue).toBe(42);
    const assistant = store.messages[1];
    expect(assistant.content).toBe("Created #42, handing off.");
    expect(assistant.toolCalls?.map((tc) => tc.status)).toEqual([
      "success",
      "success",
    ]);
  });

  it("tracks the last tool error so the surface can surface it on an empty bubble", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "show_view",
          input: {},
        }),
        d({ type: "text-delta", delta: "partial invoke text" }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { error: "renderer failed" },
        }),
        d({ type: "finish" }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("render it"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(handler.state.lastToolErrorText).toBe("renderer failed");
    expect(handler.state.lastToolErrorToolName).toBe("show_view");
    // show_view errors clear the streamed text (the invoke markup must
    // not leak into the visible chat) and flip the chip to error.
    expect(handler.state.textBuf).toBe("");
    const assistant = store.messages[1];
    expect(assistant.content).toBe("");
    expect(assistant.toolCalls?.[0].status).toBe("error");
    expect(assistant.toolCalls?.[0].result).toBe("renderer failed");
  });
});

describe("brain send→stream→persist", () => {
  it("turns a silent connection into a stalled error instead of an endless spinner", async () => {
    vi.useFakeTimers();
    // A fetch that never resolves, rejecting only on abort — models a Brain
    // server (or proxy) that accepts the connection but never writes. The
    // turn coordinator's inactivity deadline must abort it and the settle
    // seam must surface an error bubble; before Brain ran under the
    // coordinator this scenario pinned the UI in "thinking" forever.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    ) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const { store, setMessages } = messageStore(seedTurn("hello brain"));
    const { handler, loading } = makeHandler(setMessages);
    const turn = runChatTurn({
      transport: brainTransport,
      input: {
        preparedTurn: preparedTurnFixture,
        sessionId: "s1",
        text: "hello brain",
        agentId: "brain",
        context: {
          endpoint: "/api/kody/chat/brain",
          chatId: "k--global--s1",
          initialBody: { chatId: "k--global--s1", message: "hello brain" },
        },
      },
      context: { authHeaders: {}, emit: handler.handleEvent },
      inactivityMs: 5_000,
    }).catch((error) => {
      applySettleDecision(settleDecision("brain", classifyTurnFailure(error)), {
        setMessages,
        setLoading: (value) => (loading.value = value),
      });
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await turn;

    expect(loading.value).toBe(false);
    expect(store.messages[1]).toMatchObject({
      role: "assistant",
      isError: true,
      isLoading: false,
    });
    expect(store.messages[1].content).toContain("stalled");
  });

  it("replays full snapshots into the bubble and settles on chat.done", async () => {
    const l = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n`;
    restoreFetch = installFetch([
      sseResponse([
        l({ type: "chat.message", role: "assistant", content: "Hi", seq: 1 }),
        l({
          type: "chat.tool_use",
          name: "repo_read",
          input: { path: "README.md" },
          seq: 2,
        }),
        l({
          type: "chat.message",
          role: "assistant",
          content: "Hi — read the README.",
          seq: 3,
        }),
        l({ type: "chat.done", seq: 4 }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("hello brain"));
    const { handler, loading } = makeHandler(setMessages);

    await sendBrainTurn(
      {
        endpoint: "/api/kody/chat/brain",
        chatId: "k--global--s1",
        initialBody: { chatId: "k--global--s1", message: "hello brain" },
      },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(loading.value).toBe(false); // chat.done cleared the typing state
    const assistant = store.messages[1];
    expect(assistant.isLoading).toBe(false);
    expect(assistant.content).toBe("Hi — read the README.");
    // Brain chips land as completed calls, id-less.
    expect(assistant.toolCalls).toEqual([
      {
        name: "repo_read",
        arguments: { path: "README.md" },
        status: "success",
      },
    ]);
    expect(handler.state.latestAssistantText).toBe("Hi — read the README.");
    expect(handler.state.exhausted).toBe(false);
  });

  it("replaces the in-flight bubble with an error bubble on chat.error", async () => {
    const l = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n`;
    restoreFetch = installFetch([
      sseResponse([l({ type: "chat.error", error: "worktree clone failed" })]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("hello brain"));
    const { handler } = makeHandler(setMessages);

    await sendBrainTurn(
      {
        endpoint: "/api/kody/chat/brain",
        chatId: "k--global--s1",
        initialBody: { chatId: "k--global--s1", message: "hello brain" },
      },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(store.messages).toHaveLength(2);
    const last = store.messages[1];
    expect(last).toEqual({
      role: "assistant",
      content: "Error: worktree clone failed",
      isLoading: false,
      isError: true,
    });
    expect(handler.state.exhausted).toBe(false);
  });
});
