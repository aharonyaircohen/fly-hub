"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  TerminalSessionInputSchema,
  type TerminalEvent,
} from "@kody-ade/terminal/terminal-session-model";

import { authHeaders } from "../../../kody-chat-live-session";
import { getStoredBrainTerminalActivityLimit } from "../../../integration-api";
import { fetchWithTimeout, TERMINAL_START_TIMEOUT_MS } from "./terminal-http";
import {
  TerminalSessionClient,
  TerminalSessionRequestError,
  type TerminalClientSocket,
  type TerminalSessionClientState,
} from "./terminal-session-client";
import type { ChatTerminalTransport } from "./types";

const INITIAL_STATE: TerminalSessionClientState = {
  connection: "idle",
  session: null,
  error: null,
  issue: null,
  recovery: null,
};

export function sessionRequestError(input: {
  code?: string;
  message: string;
  status: number;
}): TerminalSessionRequestError {
  if (
    input.code === "terminal_gateway_not_ready" ||
    input.code === "terminal_agent_unavailable"
  ) {
    return new TerminalSessionRequestError({
      code: input.code,
      message: input.message,
      retryable: false,
      action: "setup",
    });
  }
  if (
    input.code === "fly_access_denied" ||
    input.code === "fly_token_missing"
  ) {
    return new TerminalSessionRequestError({
      code: input.code,
      message: input.message,
      retryable: false,
      action: "settings",
    });
  }
  return new TerminalSessionRequestError({
    code: input.code ?? "terminal_session_failed",
    message: input.message,
    retryable: input.status >= 500 || input.code === "machine_not_running",
    action: "retry",
  });
}

interface UseTerminalSessionOptions {
  active: boolean;
  chatSessionId: string;
  transport: Exclude<ChatTerminalTransport, { type: "local" }>;
  getSize: () => { cols: number; rows: number };
  onEvent: (event: TerminalEvent) => void;
}

function remoteTransportKey(
  transport: Exclude<ChatTerminalTransport, { type: "local" }>,
): string {
  return transport.type === "brain"
    ? "brain"
    : `fly:${transport.app}:${transport.machineId}:${transport.feature ?? ""}`;
}

export function useTerminalSession({
  active,
  chatSessionId,
  transport,
  getSize,
  onEvent,
}: UseTerminalSessionOptions) {
  const clientRef = useRef<TerminalSessionClient | null>(null);
  const getSizeRef = useRef(getSize);
  const onEventRef = useRef(onEvent);
  const transportRef = useRef(transport);
  const [state, setState] = useState<TerminalSessionClientState>(INITIAL_STATE);

  useEffect(() => {
    getSizeRef.current = getSize;
  }, [getSize]);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  const key = remoteTransportKey(transport);
  useEffect(() => {
    if (!active) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setState(INITIAL_STATE);
      return;
    }

    const client = new TerminalSessionClient({
      chatSessionId,
      transport: transportRef.current,
      activityLimit: getStoredBrainTerminalActivityLimit(),
      getSize: () => getSizeRef.current(),
      requestSession: async (body) => {
        const response = await fetchWithTimeout("/api/kody/terminal/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        }, TERMINAL_START_TIMEOUT_MS);
        const value = (await response.json().catch(() => ({}))) as {
          webSocketUrl?: string;
          session?: unknown;
          expiresAt?: string;
          message?: string;
          error?: string;
        };
        if (!response.ok || !value.webSocketUrl || !value.session) {
          throw sessionRequestError({
            code: value.error,
            message:
              value.message ??
              value.error ??
              `Terminal request failed (${response.status})`,
            status: response.status,
          });
        }
        return {
          webSocketUrl: value.webSocketUrl,
          session: TerminalSessionInputSchema.parse(value.session),
          expiresAt: value.expiresAt,
        };
      },
      createSocket: (url) =>
        new WebSocket(url) as unknown as TerminalClientSocket,
      onEvent: (event) => onEventRef.current(event),
      onState: setState,
    });
    clientRef.current = client;
    void client.connect();
    return () => {
      client.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [active, chatSessionId, key]);

  const sendInput = useCallback(
    (inputId: string, data: string) =>
      clientRef.current?.sendInput(inputId, data) ?? false,
    [],
  );
  const resize = useCallback(
    (cols: number, rows: number) =>
      clientRef.current?.resize(cols, rows) ?? false,
    [],
  );
  const clear = useCallback(() => clientRef.current?.clear() ?? false, []);
  const restart = useCallback(() => clientRef.current?.restart() ?? false, []);
  const retry = useCallback(
    (options?: { resetSession?: boolean }) =>
      clientRef.current?.retryNow(options) ?? Promise.resolve(),
    [],
  );
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  return { ...state, sendInput, resize, clear, restart, retry, disconnect };
}
