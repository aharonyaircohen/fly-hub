/**
 * Regression: a REAL captured `show_view` turn (live server, spec contract,
 * 2026-07-16) must reach the surface as a rendered-view directive. The user
 * saw a thought bubble and nothing else — this replays the exact stream.
 *
 * @testFramework vitest
 * @domain chat-core
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  sendKodyDirectTurn,
  type KodyDirectTurnConfig,
} from "../../../../src/dashboard/lib/chat/core/transports/kody-direct";
import {
  sseResponse,
  installScriptedFetch,
  eventSink,
} from "./stream-helpers";

const CONFIG: KodyDirectTurnConfig = {
  endpoint: "/api/kody/chat/kody",
  body: { messages: [{ role: "user", content: "ask for approval" }], agentId: "kody" },
};

function chunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const LIVE_DIRECTIVE = {
  "action": "render_view",
  "view": "renderer",
  "id": "view-02c4987c-05b4-499e-bc67-94338dad553e",
  "rendererSlug": "composed-view",
  "rendererName": "Composed view",
  "resultTarget": "chat",
  "ui": {
    "type": "stack",
    "children": [
      {
        "type": "text",
        "value": "Write a short random paragraph?",
        "variant": "title"
      },
      {
        "type": "markdown",
        "value": "I'll generate a brief random paragraph on any topic you'd like, or pick a fun theme myself. Reply with a topic (or say \"surprise me\") to go."
      },
      {
        "type": "row",
        "children": [
          {
            "type": "button",
            "label": "Approve",
            "action": {
              "id": "approve",
              "label": "Approve",
              "response": "approve",
              "variant": "primary"
            }
          },
          {
            "type": "button",
            "label": "Cancel",
            "action": {
              "id": "cancel",
              "label": "Cancel",
              "response": "cancel",
              "variant": "secondary"
            }
          }
        ]
      }
    ]
  },
  "data": {}
} as const;

const LIVE_TOOL_INPUT = {
  "type": "tool-input-available",
  "toolCallId": "call_anLb7wktqbnyTDFAcCTxP6jV",
  "toolName": "show_view",
  "input": {
    "root": "card",
    "elements": {
      "card": {
        "type": "Stack",
        "props": {},
        "children": [
          "title",
          "body",
          "actions"
        ]
      },
      "title": {
        "type": "Text",
        "props": {
          "value": "Write a short random paragraph?",
          "variant": "title"
        }
      },
      "body": {
        "type": "Markdown",
        "props": {
          "value": "I'll generate a brief random paragraph on any topic you'd like, or pick a fun theme myself. Reply with a topic (or say \"surprise me\") to go."
        }
      },
      "actions": {
        "type": "Row",
        "props": {},
        "children": [
          "ok",
          "no"
        ]
      },
      "ok": {
        "type": "Button",
        "props": {
          "label": "Approve",
          "response": "approve",
          "variant": "primary"
        }
      },
      "no": {
        "type": "Button",
        "props": {
          "label": "Cancel",
          "response": "cancel",
          "variant": "secondary"
        }
      }
    }
  }
} as const;

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("live show_view turn replay", () => {
  it("emits a rendered-view directive for the captured spec-contract turn", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "reasoning-delta", delta: "thinking" }),
          chunk({ type: "tool-input-start", toolCallId: "call-1", toolName: "show_view" }),
          chunk({ ...LIVE_TOOL_INPUT }),
          chunk({
            type: "tool-output-available",
            toolCallId: LIVE_TOOL_INPUT.toolCallId,
            output: LIVE_DIRECTIVE,
          }),
          chunk({ type: "finish" }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, {
      authHeaders: { "x-kody-token": "t" },
      emit: sink.emit,
    });

    const directives = sink.events.filter((e) => e.type === "directive");
    expect(directives).toEqual([
      expect.objectContaining({
        type: "directive",
        directive: expect.objectContaining({
          kind: "rendered-view",
          payload: expect.objectContaining({ action: "render_view" }),
        }),
      }),
    ]);
    expect(sink.events.some((e) => e.type === "error")).toBe(false);
  });
});
