/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern plugin-types
 * @ai-summary Shared types for the terminal chat plugin: transports,
 *   connection states, snapshots, chrome state, and the per-session chat
 *   display mode. Extracted from ChatTerminalSurface/useChatTerminalRegistry
 *   in Step 5a so the surface, registry, and connection modules share one
 *   source of truth without circular imports.
 */

export type ChatTerminalTransport =
  | { type: "local"; label?: string }
  | { type: "brain"; label?: string }
  | {
      type: "fly";
      app: string;
      machineId: string;
      label?: string;
      feature?: "runner" | "brain";
    };

export type ChatTerminalConnectionState =
  | "idle"
  | "connecting"
  | "restoring"
  | "connected"
  | "closed"
  | "error";

export interface ChatTerminalSnapshot {
  cwd?: string;
  shell?: string;
  output: string;
}

export interface TerminalInputSignal {
  tone: "idle" | "ready" | "sent" | "queued" | "blocked";
  label: string;
}

export interface ChatTerminalChromeState {
  connection: ChatTerminalConnectionState;
  statusText: string;
  inputLabel: string;
  inputTone: TerminalInputSignal["tone"];
  actionBusy: boolean;
}

export type ChatTerminalMode = "ai" | "terminal";

export interface MountedChatTerminal {
  id: string;
  sessionId: string;
  transport: ChatTerminalTransport;
}
