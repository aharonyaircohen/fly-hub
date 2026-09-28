/**
 * @fileoverview Kody-direct transport adapter specs — drives
 * sendKodyDirectTurn with scripted AI SDK SSE streams and asserts the
 * emitted ChatEvent sequences: token/reasoning deltas, the tool-call
 * path (chips, descriptions, results), final_answer replacement,
 * directive detection, tool errors, inline stream errors, HTTP failure,
 * and abort propagation.
 * @testFramework vitest
 * @domain chat-core
 */

import { describe, it, expect, afterEach } from "vitest";
import { preparedTurnFixture } from "../../../fixtures/prepared-turn";
import {
  sendKodyDirectTurn,
  kodyDirectTransport,
  KODY_DIRECT_DROPPED_MESSAGE,
  KODY_DIRECT_ERROR_CODE_DROPPED,
  KodyDirectConnectionDroppedError,
  type KodyDirectTurnConfig,
} from "../../../../src/dashboard/lib/chat/core/transports/kody-direct";
import {
  sseResponse,
  abortingResponse,
  installScriptedFetch,
  eventSink,
} from "./stream-helpers";

const CONFIG: KodyDirectTurnConfig = {
  endpoint: "/api/kody/chat/kody",
  body: { messages: [{ role: "user", content: "hi" }], agentId: "kody" },
};

function chunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("sendKodyDirectTurn", () => {
  it("finishes and cancels a hanging response after a rendered view is complete", async () => {
    const encoded = new TextEncoder().encode(
      chunk({
        type: "tool-input-available",
        toolCallId: "guided-flow-1",
        toolName: "guided_flow_start",
        input: {},
      }) +
        chunk({
          type: "tool-output-available",
          toolCallId: "guided-flow-1",
          output: {
            action: "render_view",
            view: "renderer",
            id: "assessment-intake",
            rendererSlug: "guided-flow",
            rendererName: "Project assessment",
            resultTarget: "guided-flow",
            guidedFlow: {
              instanceId: "assessment-1",
              stepId: "intake",
              revision: 1,
            },
            ui: { type: "stack", children: [] },
            data: {},
          },
        }),
    );
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded);
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
    const { restore } = installScriptedFetch([() => response]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(cancelled).toBe(true);
    expect(sink.events.at(-1)).toEqual({ type: "done" });
    expect(sink.events).toContainEqual(
      expect.objectContaining({
        type: "directive",
        directive: expect.objectContaining({ kind: "rendered-view" }),
      }),
    );
  });

  it("emits a visible notice when Automatic switches models", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-automatic-fallback",
            data: { from: "Model A", to: "Model B", reason: "timeout" },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "notice",
        message: "Model A timed out. Continuing with Model B.",
      },
      { type: "done" },
    ]);
  });

  it("POSTs the body once and emits token/reasoning deltas in order", async () => {
    const { calls, restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "reasoning-delta", delta: "thinking " }),
          chunk({ type: "text-delta", delta: "Hello " }),
          "data: {corrupt\n\n", // skipped, stream continues
          chunk({ type: "text-delta", delta: "world" }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, {
      authHeaders: { "x-kody-token": "t" },
      emit: sink.emit,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/kody/chat/kody");
    expect(calls[0].body).toEqual(CONFIG.body);
    expect(calls[0].init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-kody-token": "t",
    });
    expect(sink.events).toEqual([
      { type: "reasoning", text: "thinking " },
      { type: "token", text: "Hello " },
      { type: "token", text: "world" },
      { type: "done" },
    ]);
  });

  it("emits a running tool chip with its indexed description, then the success result", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-tools-index",
            data: { fetch_url: "Fetch a URL", noise: 42 },
          }),
          chunk({
            type: "tool-input-start",
            toolCallId: "call-1",
            toolName: "fetch_url",
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "fetch_url",
            input: { url: "https://x" },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "call-1",
            output: { ok: true },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "call-1",
        toolName: "fetch_url",
        input: { url: "https://x" },
        status: "running",
        description: "Fetch a URL",
      },
      {
        type: "tool-result",
        id: "call-1",
        toolName: "fetch_url",
        output: { ok: true },
      },
      { type: "done" },
    ]);
  });

  it("treats preliminary tool results as activity without completing the tool", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "specialist-1",
            toolName: "request_specialist_evidence",
            input: { assignments: [] },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "specialist-1",
            output: { status: "running" },
            preliminary: true,
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "specialist-1",
            output: { status: "completed", findings: [] },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      expect.objectContaining({
        type: "tool-call",
        id: "specialist-1",
        status: "running",
      }),
      { type: "reasoning", text: "\u200b" },
      {
        type: "tool-result",
        id: "specialist-1",
        toolName: "request_specialist_evidence",
        output: { status: "completed", findings: [] },
      },
      { type: "done" },
    ]);
  });

  it("maps subagent activity into a visible running and completed Thought item", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "started",
              agentTitle: "Agency Specialist",
              task: "Explain AI Agency structure.",
            },
          }),
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "heartbeat",
              agentTitle: "Agency Specialist",
            },
          }),
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "reasoning",
              agentTitle: "Agency Specialist",
              reasoningDelta: "I checked the seven ",
            },
          }),
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "reasoning",
              agentTitle: "Agency Specialist",
              reasoningDelta: "Agency model definitions.",
            },
          }),
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "completed",
              agentTitle: "Agency Specialist",
            },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "subagent-agency-specialist",
        toolName: "subagent",
        input: { task: "Explain AI Agency structure." },
        status: "running",
        activityKind: "subagent",
        displayName: "Agency Specialist",
        description: "Working on delegated specialist research.",
      },
      {
        type: "reasoning",
        text: "​",
      },
      {
        type: "reasoning",
        text: "Agency Specialist:\n",
      },
      {
        type: "reasoning",
        text: "I checked the seven ",
      },
      {
        type: "reasoning",
        text: "Agency model definitions.",
      },
      {
        type: "tool-result",
        id: "subagent-agency-specialist",
        toolName: "subagent",
        output: { status: "completed" },
      },
      { type: "done" },
    ]);
  });

  it("preserves a safe specialist failure reason for the activity panel", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "started",
              agentTitle: "Agency Specialist",
              task: "Explain AI Agency structure.",
            },
          }),
          chunk({
            type: "data-subagent-activity",
            data: {
              id: "subagent-agency-specialist",
              phase: "failed",
              agentTitle: "Agency Specialist",
              errorText:
                "The specialist timed out. Retry or choose another model. (trace a1b2c3d4)",
            },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events.at(1)).toEqual({
      type: "tool-result",
      id: "subagent-agency-specialist",
      toolName: "subagent",
      output: { status: "failed" },
      isError: true,
      errorText:
        "The specialist timed out. Retry or choose another model. (trace a1b2c3d4)",
    });
  });

  it("final_answer never becomes a chip; its output replaces the streamed text", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "text-delta", delta: "draft..." }),
          chunk({
            type: "tool-input-available",
            toolCallId: "fa-1",
            toolName: "final_answer",
            input: { content: "Final." },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "fa-1",
            output: { content: "Final." },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "draft..." },
      { type: "text-replace", text: "Final." },
      { type: "done" },
    ]);
  });

  it("does not expose provider draft text before an exclusive rendered-view output", async () => {
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
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "text-delta",
            delta: "Want me to continue?",
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "view-1",
            toolName: "show_view",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "view-1",
            output: renderedView,
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).not.toContainEqual({
      type: "token",
      text: "Want me to continue?",
    });
    expect(sink.events).toContainEqual({
      type: "directive",
      directive: {
        kind: "rendered-view",
        payload: renderedView,
        presentation: "replace",
      },
    });
  });

  it("publishes only the committed answer across private model attempts", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "reasoning-delta",
            delta: "The user said hi. I should answer normally.",
          }),
          chunk({ type: "text-delta", delta: "first draft" }),
          chunk({
            type: "reasoning-delta",
            delta: "The first attempt missed final_answer. Retrying.",
          }),
          chunk({ type: "text-delta", delta: "second draft" }),
          chunk({
            type: "tool-input-available",
            toolCallId: "final-1",
            toolName: "final_answer",
            input: { content: "Final answer." },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "final-1",
            output: { content: "Final answer." },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "text-replace", text: "Final answer." },
      { type: "done" },
    ]);
  });

  it("streams final_answer content after the output tool commits the turn to text", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "tool-input-start",
            toolCallId: "final-stream",
            toolName: "final_answer",
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-stream",
            inputTextDelta: '{"content":"Hello',
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-stream",
            inputTextDelta: " streamed",
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-stream",
            inputTextDelta: ' world."}',
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "final-stream",
            toolName: "final_answer",
            input: { content: "Hello streamed world." },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "final-stream",
            output: { content: "Hello streamed world." },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " streamed" },
      { type: "token", text: " world." },
      { type: "text-replace", text: "Hello streamed world." },
      { type: "done" },
    ]);
  });

  it("ignores visible text that arrives after final_answer commits", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "final-committed",
            toolName: "final_answer",
            input: { content: "LIVE-9142" },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "final-committed",
            output: { content: "LIVE-9142" },
          }),
          chunk({ type: "text-delta", delta: "Open todo: internal" }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "text-replace", text: "LIVE-9142" },
      { type: "done" },
    ]);
  });

  it("marks a renderer after committed text as an appended message part", async () => {
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
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "final-before-view",
            toolName: "final_answer",
            input: { content: "Here is the context." },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "final-before-view",
            output: { content: "Here is the context." },
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "view-after-text",
            toolName: "show_view",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "view-after-text",
            output: renderedView,
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toContainEqual({
      type: "directive",
      directive: {
        kind: "rendered-view",
        payload: renderedView,
        presentation: "append",
      },
    });
  });

  it("decodes split JSON escapes without duplicating streamed final_answer text", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          }),
          chunk({
            type: "tool-input-start",
            toolCallId: "final-escaped",
            toolName: "final_answer",
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-escaped",
            inputTextDelta: '{"content":"Line 1\\',
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-escaped",
            inputTextDelta: 'n\\"quoted\\" \\u26',
          }),
          chunk({
            type: "tool-input-delta",
            toolCallId: "final-escaped",
            inputTextDelta: '3a"}',
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "final-escaped",
            toolName: "final_answer",
            input: { content: 'Line 1\n"quoted" ☺' },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "final-escaped",
            output: { content: 'Line 1\n"quoted" ☺' },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "Line 1" },
      { type: "token", text: '\n"quoted" ' },
      { type: "token", text: "☺" },
      { type: "text-replace", text: 'Line 1\n"quoted" ☺' },
      { type: "done" },
    ]);
  });

  it("emits an error tool-result (with the tool name) for `{ error }` outputs — no directives", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "c1",
            toolName: "show_view",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "c1",
            output: { error: "renderer exploded" },
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "c1",
        toolName: "show_view",
        input: {},
        status: "running",
      },
      {
        type: "tool-result",
        id: "c1",
        toolName: "show_view",
        output: { error: "renderer exploded" },
        isError: true,
        errorText: "renderer exploded",
      },
      { type: "done" },
    ]);
  });

  it("emits an error tool-result WITHOUT a tool name for stream-level tool-output-error", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-output-error",
            toolCallId: "c9",
            errorText: "timed out",
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "tool-result", id: "c9", isError: true, errorText: "timed out" },
      { type: "done" },
    ]);
  });

  it("preserves stream-level tool-input-error details", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-error",
            toolCallId: "c10",
            errorText: "arguments must include owner and repo",
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-result",
        id: "c10",
        isError: true,
        errorText: "arguments must include owner and repo",
      },
      { type: "done" },
    ]);
  });

  it("detects directives by shape and emits them before the success result", async () => {
    const switchAgent = {
      action: "switch_agent",
      agentId: "kody-live",
      agentName: "Kody Live",
      reason: "execution requested",
      autoKickoff: "go",
    };
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "c2",
            toolName: "switch_agent",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "c2",
            output: switchAgent,
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "c2",
        toolName: "switch_agent",
        input: {},
        status: "running",
      },
      {
        type: "directive",
        directive: { kind: "switch-agent", payload: switchAgent },
      },
      {
        type: "tool-result",
        id: "c2",
        toolName: "switch_agent",
        output: switchAgent,
      },
      { type: "done" },
    ]);
  });

  it("detects dashboard_navigate and preview_act directives", async () => {
    const navigate = {
      action: "dashboard_navigate",
      routeId: "models",
      href: "/models",
      label: "Chat Models",
      reason: "user asked",
    };
    const act = {
      action: "preview_act",
      op: "click",
      reason: "press the button",
    };
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "n1",
            toolName: "dashboard_navigate",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "n1",
            output: navigate,
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "p1",
            toolName: "preview_act",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "p1",
            output: act,
          }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    const directives = sink.events.filter((e) => e.type === "directive");
    expect(directives).toEqual([
      {
        type: "directive",
        directive: { kind: "dashboard-navigate", payload: navigate },
      },
      { type: "directive", directive: { kind: "preview-act", payload: act } },
    ]);
  });

  it("emits inline stream errors as RECOVERABLE error events", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "text-delta", delta: "partial" }),
          chunk({ type: "error", errorText: "model overloaded" }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "partial" },
      { type: "error", message: "model overloaded", recoverable: true },
      { type: "done" },
    ]);
  });

  it("turns tool-protocol failures into a clear model operation notice", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "error",
            errorText:
              "[trace a1b2c3d4] No endpoints found that support tool use",
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "error",
        message:
          "This model could not complete the requested operation with the available tools. Choose another model and try again. (trace a1b2c3d4)",
        recoverable: true,
      },
      { type: "done" },
    ]);
  });

  it("throws the response text on HTTP failure", async () => {
    const { restore } = installScriptedFetch([
      () => new Response("model not configured", { status: 500 }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("model not configured");
    expect(sink.events).toEqual([]);
  });

  it("uses the route error and trace ID from a JSON HTTP failure", async () => {
    const { restore } = installScriptedFetch([
      () =>
        new Response(
          JSON.stringify({ error: "chat setup failed", traceId: "a1b2c3d4" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("chat setup failed (trace a1b2c3d4)");
    expect(sink.events).toEqual([]);
  });

  it("propagates AbortError mid-stream (surface owns stop semantics)", async () => {
    const { restore } = installScriptedFetch([
      () => abortingResponse([chunk({ type: "text-delta", delta: "par" })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sink.events).toEqual([{ type: "token", text: "par" }]);
  });

  it("reports a resumable disconnect when the stream ends without a terminal marker", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "reasoning-delta", delta: "thinking…" }),
          chunk({ type: "text-delta", delta: "partial" }),
          // No `finish` chunk, no `[DONE]`: the connection dropped.
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: KodyDirectConnectionDroppedError.name,
        message: KODY_DIRECT_DROPPED_MESSAGE,
        code: KODY_DIRECT_ERROR_CODE_DROPPED,
      }),
    );

    expect(sink.events).toEqual([
      { type: "reasoning", text: "thinking…" },
      { type: "token", text: "partial" },
    ]);
  });

  it("treats a `finish` chunk as terminal even without the [DONE] sentinel", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "text-delta", delta: "hi" }),
          chunk({ type: "finish" }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "hi" },
      { type: "done" },
    ]);
  });
});

describe("kodyDirectTransport (ChatTransport wrapper)", () => {
  it("sends the canonical conversation and durable turn identity", async () => {
    const { calls, restore } = installScriptedFetch([
      () => sseResponse(["data: [DONE]\n\n"]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await kodyDirectTransport.send(
      {
        preparedTurn: preparedTurnFixture,
        sessionId: "conversation-7",
        turnId: "turn-9",
        text: "hi",
        agentId: "kody",
        context: { ...CONFIG },
      },
      { authHeaders: {}, emit: sink.emit },
    );

    expect(calls[0].body).toMatchObject({
      conversationId: "conversation-7",
      turnId: "turn-9",
      conversationAgent: preparedTurnFixture.speaker,
    });
  });

  it("rejects when input.context is not a KodyDirectTurnConfig", async () => {
    const sink = eventSink();
    await expect(
      kodyDirectTransport.send(
        {
          preparedTurn: preparedTurnFixture,
          sessionId: "s",
          text: "hi",
          agentId: "kody",
        },
        { authHeaders: {}, emit: sink.emit },
      ),
    ).rejects.toThrow(/KodyDirectTurnConfig/);
  });
});
