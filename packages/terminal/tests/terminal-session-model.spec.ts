import { describe, expect, it } from "vitest";

import {
  TerminalCommandSchema,
  TerminalEventSchema,
  TerminalSessionInputSchema,
} from "../src/terminal-session-model";
import { isTerminalMachineTransitioning } from "../src/session";

describe("terminal session model", () => {
  it("treats machine shutdown phases as transitions that can still recover", () => {
    expect(isTerminalMachineTransitioning("suspending")).toBe(true);
    expect(isTerminalMachineTransitioning("stopping")).toBe(true);
  });
  it("validates the transport-neutral session identity", () => {
    expect(
      TerminalSessionInputSchema.parse({
        id: "session-1",
        scope: {
          owner: "kody",
          repo: "chat",
          conversationId: "conversation-1",
        },
        target: { kind: "brain", runtimeId: "brain-1" },
      }),
    ).toEqual({
      id: "session-1",
      scope: {
        owner: "kody",
        repo: "chat",
        conversationId: "conversation-1",
      },
      target: { kind: "brain", runtimeId: "brain-1" },
    });

    expect(() =>
      TerminalSessionInputSchema.parse({
        id: " ",
        scope: { owner: "kody", repo: "chat", conversationId: "c" },
        target: { kind: "brain", runtimeId: "brain-1" },
      }),
    ).toThrow();
  });

  it("validates every command and preserves terminal control data", () => {
    const commands = [
      { type: "attach", sessionId: "session-1", afterRevision: 4 },
      {
        type: "input",
        sessionId: "session-1",
        inputId: "input-1",
        data: "\u0003",
      },
      { type: "resize", sessionId: "session-1", cols: 120, rows: 40 },
      { type: "detach", sessionId: "session-1" },
      { type: "restart", sessionId: "session-1" },
    ];

    for (const command of commands) {
      expect(TerminalCommandSchema.parse(command)).toEqual(command);
    }

    expect(() =>
      TerminalCommandSchema.parse({
        type: "resize",
        sessionId: "session-1",
        cols: 0,
        rows: 40,
      }),
    ).toThrow();
    expect(() =>
      TerminalCommandSchema.parse({
        type: "input",
        sessionId: "session-1",
        inputId: "input-1",
        data: "",
      }),
    ).toThrow();
  });

  it("requires session and generation identity on every event", () => {
    const event = {
      type: "output",
      sessionId: "session-1",
      generation: 2,
      revision: 8,
      data: "hello",
    };

    expect(TerminalEventSchema.parse(event)).toEqual(event);
    expect(() =>
      TerminalEventSchema.parse({
        type: "output",
        revision: 8,
        data: "hello",
      }),
    ).toThrow();
  });
});
