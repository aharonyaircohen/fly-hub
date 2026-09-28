import {
  TerminalCommandSchema,
  TerminalEventSchema,
  TerminalSessionInputSchema,
  type TerminalCommand,
  type TerminalEvent,
  type TerminalSession,
  type TerminalSessionAction,
  type TerminalSessionInput,
  type TerminalSessionState,
} from "./terminal-session-model";

const EVENT_TRANSITIONS: Readonly<
  Record<TerminalSessionState, ReadonlySet<TerminalSessionState>>
> = {
  starting: new Set(["ready", "failed"]),
  ready: new Set(["detached", "exited", "failed"]),
  detached: new Set(["ready", "exited", "failed"]),
  exited: new Set(),
  failed: new Set(),
};

const COMMAND_STATES: Readonly<
  Record<TerminalCommand["type"], ReadonlySet<TerminalSessionState>>
> = {
  attach: new Set(["starting", "ready", "detached"]),
  clear: new Set(["ready"]),
  input: new Set(["ready"]),
  resize: new Set(["ready"]),
  detach: new Set(["starting", "ready", "detached"]),
  restart: new Set(["ready", "detached", "exited", "failed"]),
};

export class TerminalSessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalSessionTransitionError";
  }
}

export function createTerminalSession(
  rawInput: TerminalSessionInput,
): TerminalSession {
  const input = TerminalSessionInputSchema.parse(rawInput);
  return {
    ...input,
    generation: 1,
    state: "starting",
    revision: 0,
  };
}

function assertSessionIdentity(
  session: TerminalSession,
  actionSessionId: string,
): void {
  if (session.id !== actionSessionId) {
    throw new TerminalSessionTransitionError(
      `Action targets terminal session ${actionSessionId}, not ${session.id}`,
    );
  }
}

function transitionState(
  session: TerminalSession,
  nextState: TerminalSessionState,
): TerminalSession {
  if (session.state === nextState) return session;
  if (!EVENT_TRANSITIONS[session.state].has(nextState)) {
    throw new TerminalSessionTransitionError(
      `Terminal session cannot transition from ${session.state} to ${nextState}`,
    );
  }
  return { ...session, state: nextState };
}

function reduceCommand(
  session: TerminalSession,
  rawCommand: TerminalCommand,
): TerminalSession {
  const command = TerminalCommandSchema.parse(rawCommand);
  assertSessionIdentity(session, command.sessionId);

  if (!COMMAND_STATES[command.type].has(session.state)) {
    throw new TerminalSessionTransitionError(
      `${command.type} is not allowed while terminal session is ${session.state}`,
    );
  }

  if (command.type !== "restart") return session;
  return {
    ...session,
    generation: session.generation + 1,
    state: "starting",
    revision: 0,
  };
}

function stateForEvent(event: TerminalEvent): TerminalSessionState | null {
  switch (event.type) {
    case "state":
      return event.state;
    case "exited":
      return "exited";
    case "failed":
      return "failed";
    case "output":
    case "input-accepted":
      return null;
  }
}

function reduceEvent(
  session: TerminalSession,
  rawEvent: TerminalEvent,
): TerminalSession {
  const event = TerminalEventSchema.parse(rawEvent);
  assertSessionIdentity(session, event.sessionId);

  if (event.generation < session.generation) return session;
  if (event.generation > session.generation) {
    throw new TerminalSessionTransitionError(
      `Event generation ${event.generation} is ahead of terminal generation ${session.generation}`,
    );
  }

  if (event.type === "output") {
    if (!["starting", "ready", "detached"].includes(session.state)) {
      throw new TerminalSessionTransitionError(
        `output is not allowed while terminal session is ${session.state}`,
      );
    }
    return event.revision <= session.revision
      ? session
      : { ...session, revision: event.revision };
  }

  const nextState = stateForEvent(event);
  return nextState ? transitionState(session, nextState) : session;
}

export function reduceTerminalSession(
  session: TerminalSession,
  action: TerminalSessionAction,
): TerminalSession {
  switch (action.type) {
    case "command":
      return reduceCommand(session, action.command);
    case "event":
      return reduceEvent(session, action.event);
  }
}
