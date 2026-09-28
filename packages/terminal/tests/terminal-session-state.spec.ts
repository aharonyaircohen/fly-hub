import { describe, expect, it } from "vitest";

import type {
  TerminalEvent,
  TerminalSessionState,
} from "../src/terminal-session-model";
import {
  createTerminalSession,
  reduceTerminalSession,
  TerminalSessionTransitionError,
} from "../src/terminal-session-state";

const input = {
  id: "session-1",
  scope: {
    owner: "kody",
    repo: "chat",
    conversationId: "conversation-1",
  },
  target: { kind: "brain" as const, runtimeId: "brain-1" },
};

function stateEvent(state: TerminalSessionState): TerminalEvent {
  return {
    type: "state",
    sessionId: input.id,
    generation: 1,
    state,
  };
}

describe("terminal session state", () => {
  it("creates a first-generation starting session", () => {
    expect(createTerminalSession(input)).toEqual({
      ...input,
      generation: 1,
      state: "starting",
      revision: 0,
    });
  });

  it("exhaustively enforces lifecycle transitions", () => {
    const states: readonly TerminalSessionState[] = [
      "starting",
      "ready",
      "detached",
      "exited",
      "failed",
    ];
    const allowed = new Set([
      "starting:ready",
      "starting:failed",
      "ready:detached",
      "ready:exited",
      "ready:failed",
      "detached:ready",
      "detached:exited",
      "detached:failed",
    ]);

    for (const from of states) {
      for (const to of states) {
        const session = { ...createTerminalSession(input), state: from };
        const reduce = () =>
          reduceTerminalSession(session, {
            type: "event",
            event: stateEvent(to),
          });

        if (from === to) {
          expect(reduce(), `${from} -> ${to}`).toBe(session);
        } else if (allowed.has(`${from}:${to}`)) {
          expect(reduce().state, `${from} -> ${to}`).toBe(to);
        } else {
          expect(reduce, `${from} -> ${to}`).toThrow(
            TerminalSessionTransitionError,
          );
        }
      }
    }
  });

  it("makes duplicate state events idempotent", () => {
    const session = {
      ...createTerminalSession(input),
      state: "ready" as const,
    };
    expect(
      reduceTerminalSession(session, {
        type: "event",
        event: stateEvent("ready"),
      }),
    ).toBe(session);
  });

  it("advances output revisions monotonically and ignores duplicates", () => {
    const ready = { ...createTerminalSession(input), state: "ready" as const };
    const output: TerminalEvent = {
      type: "output",
      sessionId: input.id,
      generation: 1,
      revision: 3,
      data: "output",
    };
    const advanced = reduceTerminalSession(ready, {
      type: "event",
      event: output,
    });

    expect(advanced.revision).toBe(3);
    expect(
      reduceTerminalSession(advanced, {
        type: "event",
        event: { ...output, revision: 2 },
      }),
    ).toBe(advanced);
  });

  it("ignores stale generations and rejects unknown future generations", () => {
    const session = {
      ...createTerminalSession(input),
      generation: 2,
      state: "ready" as const,
    };

    expect(
      reduceTerminalSession(session, {
        type: "event",
        event: { ...stateEvent("failed"), generation: 1 },
      }),
    ).toBe(session);
    expect(() =>
      reduceTerminalSession(session, {
        type: "event",
        event: { ...stateEvent("failed"), generation: 3 },
      }),
    ).toThrow(TerminalSessionTransitionError);
  });

  it("rejects events and commands for another session", () => {
    const session = createTerminalSession(input);

    expect(() =>
      reduceTerminalSession(session, {
        type: "command",
        command: { type: "attach", sessionId: "other" },
      }),
    ).toThrow(TerminalSessionTransitionError);
    expect(() =>
      reduceTerminalSession(session, {
        type: "event",
        event: { ...stateEvent("ready"), sessionId: "other" },
      }),
    ).toThrow(TerminalSessionTransitionError);
  });

  it.each(["ready", "detached", "exited", "failed"] as const)(
    "uses explicit restart to create a new generation from %s",
    (state) => {
      const session = {
        ...createTerminalSession(input),
        state,
        revision: 9,
      };
      expect(
        reduceTerminalSession(session, {
          type: "command",
          command: { type: "restart", sessionId: input.id },
        }),
      ).toEqual({
        ...session,
        generation: 2,
        state: "starting",
        revision: 0,
      });
    },
  );

  it("rejects restart while a generation is already starting", () => {
    const session = createTerminalSession(input);
    expect(() =>
      reduceTerminalSession(session, {
        type: "command",
        command: { type: "restart", sessionId: input.id },
      }),
    ).toThrow(TerminalSessionTransitionError);
  });

  it.each([
    ["input", "starting"],
    ["resize", "detached"],
    ["detach", "exited"],
  ] as const)("rejects %s while %s", (type, state) => {
    const session = { ...createTerminalSession(input), state };
    const command =
      type === "input"
        ? {
            type,
            sessionId: input.id,
            inputId: "input-1",
            data: "ls\n",
          }
        : type === "resize"
          ? { type, sessionId: input.id, cols: 80, rows: 24 }
          : { type, sessionId: input.id };

    expect(() =>
      reduceTerminalSession(session, { type: "command", command }),
    ).toThrow(TerminalSessionTransitionError);
  });
});
