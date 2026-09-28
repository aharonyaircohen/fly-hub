import {
  TerminalCommandSchema,
  TerminalEventSchema,
  type TerminalCommand,
  type TerminalEvent,
} from "@kody-ade/terminal/terminal-session-model";

export interface BrainTerminalProxyClaims {
  owner: string;
  repo: string;
  chatSessionId: string;
  conversationId?: string;
  afterRevision?: number;
  cols: number;
  rows: number;
}

export function buildBrainTerminalOpenRequest(
  claims: BrainTerminalProxyClaims,
) {
  return {
    type: "open" as const,
    session: {
      id: claims.chatSessionId,
      scope: {
        owner: claims.owner,
        repo: claims.repo,
        conversationId: claims.conversationId ?? claims.chatSessionId,
      },
    },
    cwd: "/workspace/repo",
    ...(claims.afterRevision !== undefined
      ? { afterRevision: claims.afterRevision }
      : {}),
    cols: claims.cols,
    rows: claims.rows,
  };
}

export function normalizeBrainTerminalCommand(
  value: unknown,
  authenticatedSessionId: string,
): TerminalCommand {
  if (!value || typeof value !== "object") {
    throw new Error("terminal command must be an object");
  }
  const command = value as Record<string, unknown>;
  if (
    command.sessionId !== undefined &&
    command.sessionId !== authenticatedSessionId
  ) {
    throw new Error("terminal command session identity mismatch");
  }
  return TerminalCommandSchema.parse({
    ...command,
    sessionId: authenticatedSessionId,
    ...(command.type === "input" && command.inputId === undefined
      ? { inputId: String(command.id ?? "") }
      : {}),
  });
}

export function parseBrainTerminalAgentLine(line: string): TerminalEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = TerminalEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
