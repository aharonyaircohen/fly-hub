/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern checkpoint-transport-shims
 * @ai-summary Checkpoint-transport shims moved out of KodyChat in Step 5a:
 *   map a chat terminal transport onto the checkpoint API's transport shape,
 *   build the checkpoint GET query, and decide when a checkpoint may load
 *   (never over a live terminal; once per session/target/actor key).
 */
import type { TerminalCheckpointTransport } from "@kody-ade/terminal/checkpoint-types";
import type { ChatTerminalMode, ChatTerminalTransport } from "./types";

export function checkpointTransportFromChatTransport(
  transport: ChatTerminalTransport,
): TerminalCheckpointTransport {
  if (transport.type === "brain") {
    return {
      type: "brain",
      label: transport.label,
    };
  }
  if (transport.type === "fly") {
    return {
      type: "fly",
      app: transport.app,
      machineId: transport.machineId,
      label: transport.label,
      feature: transport.feature,
    };
  }
  return {
    type: "local",
    label: transport.label,
  };
}

export function terminalCheckpointSearchParams(
  actorLogin: string | null | undefined,
  transport: ChatTerminalTransport,
  chatSessionId: string,
): string {
  const params = new URLSearchParams({
    chatSessionId,
    transport: JSON.stringify(checkpointTransportFromChatTransport(transport)),
  });
  if (actorLogin) params.set("actorLogin", actorLogin);
  return `?${params.toString()}`;
}

/** Dedup key for one checkpoint load attempt (session + target + actor). */
export function terminalCheckpointLoadKey(args: {
  actorLogin: string | null | undefined;
  activeSessionId: string;
  activeTargetValue: string;
}): string {
  return JSON.stringify({
    actorLogin: args.actorLogin,
    activeSessionIdForReset: args.activeSessionId,
    activeTerminalValue: args.activeTargetValue,
  });
}

/**
 * A checkpoint may load only in terminal mode, for an active session, and
 * NEVER over a live terminal (a replay would clobber the running shell).
 * The loadedKey guard makes each session/target/actor combination load at
 * most once.
 */
export function shouldLoadTerminalCheckpoint(args: {
  chatMode: ChatTerminalMode;
  activeSessionId: string | null;
  hasLiveTerminal: boolean;
  loadedKey: string | null;
  nextKey: string;
}): boolean {
  if (args.chatMode !== "terminal" || !args.activeSessionId) return false;
  if (args.hasLiveTerminal) return false;
  return args.loadedKey !== args.nextKey;
}
