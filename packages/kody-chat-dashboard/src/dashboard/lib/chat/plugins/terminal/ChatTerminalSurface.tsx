/**
 * @fileType component
 * @domain chat-plugin-terminal
 * @pattern terminal-surface-controller
 *
 * Renders one xterm view and routes user intent to either the local PTY API or
 * the remote TerminalSessionClient. Durable remote lifecycle is Brain-owned.
 */
"use client";

import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { TerminalEvent } from "@kody-ade/terminal/terminal-session-model";
import { toast } from "sonner";

import { authHeaders } from "../../../kody-chat-live-session";
import {
  fetchWithTimeout,
  LOCAL_OUTPUT_READ_TIMEOUT_MS,
  LOCAL_OUTPUT_WAIT_MS,
  TERMINAL_INPUT_TIMEOUT_MS,
  TERMINAL_RESIZE_TIMEOUT_MS,
  TERMINAL_START_TIMEOUT_MS,
  TERMINAL_STOP_TIMEOUT_MS,
} from "./terminal-http";
import { usefulCapturedOutput, captureTerminalOutput } from "./terminal-text";
import {
  terminalStartupIssue,
  type VisibleTerminalStartupIssue,
} from "./terminal-startup-issue";
import type { TerminalStartupIssue } from "./terminal-session-client";
import { TerminalView, type TerminalViewHandle } from "./TerminalView";
import type {
  ChatTerminalChromeState,
  ChatTerminalConnectionState,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
  TerminalInputSignal,
} from "./types";
import { useTerminalSession } from "./use-terminal-session";

export type {
  ChatTerminalChromeState,
  ChatTerminalConnectionState,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
} from "./types";

interface LocalTerminalSession {
  sessionId: string;
  cwd: string;
  shell: string;
  cursor: number;
  alive: boolean;
}

type LocalTerminalEvent =
  | { id: number; type: "output"; data: string; at: string }
  | { id: number; type: "exit"; code?: number; signal?: number; at: string };

interface ChatTerminalSurfaceProps {
  active: boolean;
  chatSessionId: string;
  transport?: ChatTerminalTransport;
  topToolbar?: ReactNode;
  onAddToChat: (context: string) => void;
  onChromeStateChange?: (state: ChatTerminalChromeState) => void;
  onSessionEnded?: (snapshot: ChatTerminalSnapshot) => void;
}

export interface ChatTerminalSurfaceHandle {
  sendLine: (line: string) => boolean;
  sendText: (text: string) => boolean;
  executeText: (text: string) => boolean;
  addToChat: () => void;
  clear: () => void;
  restart: () => void;
  stop: () => Promise<void>;
  prepareForRuntimeChange: () => void;
  reconnectFresh: () => Promise<void>;
  focus: () => void;
  getSnapshot: () => ChatTerminalSnapshot;
}

const LOCAL_TRANSPORT: ChatTerminalTransport = { type: "local" };
const REMOTE_FALLBACK = { type: "brain" as const };

function isRemoteTransport(
  transport: ChatTerminalTransport,
): transport is Exclude<ChatTerminalTransport, { type: "local" }> {
  return transport.type !== "local";
}

export const ChatTerminalSurface = forwardRef<
  ChatTerminalSurfaceHandle,
  ChatTerminalSurfaceProps
>(function ChatTerminalSurface(
  {
    active,
    chatSessionId,
    transport = LOCAL_TRANSPORT,
    topToolbar,
    onAddToChat,
    onChromeStateChange,
    onSessionEnded,
  },
  ref,
) {
  const viewRef = useRef<TerminalViewHandle | null>(null);
  const localSessionRef = useRef<LocalTerminalSession | null>(null);
  const transportRef = useRef(transport);
  const outputCaptureRef = useRef("");
  const pollBusyRef = useRef(false);
  const startingLocalRef = useRef(false);
  const localInputQueueRef = useRef<Promise<void>>(Promise.resolve());
  const localInputBlockedRef = useRef(false);
  const sessionEndNotifiedRef = useRef(false);
  const nextInputIdRef = useRef(1);
  const inputSignalTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [connectingLocal, setConnectingLocal] = useState(false);
  const [localSession, setLocalSession] = useState<LocalTerminalSession | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupIssue, setSetupIssue] = useState<TerminalStartupIssue | null>(
    null,
  );
  const [inputSignal, setInputSignal] = useState<TerminalInputSignal>({
    tone: "idle",
    label: "No input",
  });

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);
  useEffect(() => {
    localSessionRef.current = localSession;
  }, [localSession]);

  const appendCapturedOutput = useCallback((data: string) => {
    outputCaptureRef.current = captureTerminalOutput(
      outputCaptureRef.current,
      data,
    );
  }, []);
  const handleViewReady = useCallback(() => setReady(true), []);

  const getSnapshot = useCallback(
    (): ChatTerminalSnapshot => ({
      cwd: localSessionRef.current?.cwd,
      shell: localSessionRef.current?.shell,
      output: usefulCapturedOutput(outputCaptureRef.current),
    }),
    [],
  );

  const notifySessionEnded = useCallback(() => {
    if (sessionEndNotifiedRef.current) return;
    sessionEndNotifiedRef.current = true;
    const snapshot = getSnapshot();
    if (snapshot.output.trim()) onSessionEnded?.(snapshot);
  }, [getSnapshot, onSessionEnded]);

  const setInputSignalBriefly = useCallback(
    (signal: TerminalInputSignal, fallback: TerminalInputSignal) => {
      if (inputSignalTimerRef.current !== null) {
        window.clearTimeout(inputSignalTimerRef.current);
      }
      setInputSignal(signal);
      inputSignalTimerRef.current = window.setTimeout(() => {
        setInputSignal(fallback);
        inputSignalTimerRef.current = null;
      }, 1400);
    },
    [],
  );

  const handleRemoteEvent = useCallback(
    (event: TerminalEvent) => {
      switch (event.type) {
        case "output":
          appendCapturedOutput(event.data);
          viewRef.current?.write(event.data);
          return;
        case "input-accepted":
          setInputSignal({ tone: "ready", label: "Ready for input" });
          return;
        case "exited":
          viewRef.current?.writeln(
            `\r\nProcess exited${event.code === undefined ? "" : ` (${event.code})`}`,
          );
          setInputSignal({ tone: "blocked", label: "Process exited" });
          notifySessionEnded();
          return;
        case "failed":
          viewRef.current?.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
          setInputSignal({ tone: "blocked", label: "Terminal failed" });
          return;
        case "state":
          if (event.state === "ready") {
            sessionEndNotifiedRef.current = false;
            setInputSignal({ tone: "ready", label: "Ready for input" });
          } else if (event.state !== "exited") {
            setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
          }
      }
    },
    [appendCapturedOutput, notifySessionEnded],
  );

  const getSize = useCallback(
    () => ({
      cols: viewRef.current?.getSize().cols ?? 120,
      rows: viewRef.current?.getSize().rows ?? 36,
    }),
    [],
  );
  const {
    connection: remoteConnection,
    session: remoteSession,
    error: remoteError,
    issue: remoteIssue,
    recovery: remoteRecovery,
    sendInput: sendRemoteInput,
    resize: resizeRemote,
    clear: clearRemote,
    restart: restartRemote,
    retry: retryRemote,
    disconnect: disconnectRemote,
  } = useTerminalSession({
    active: active && ready && isRemoteTransport(transport),
    chatSessionId,
    transport: isRemoteTransport(transport) ? transport : REMOTE_FALLBACK,
    getSize,
    onEvent: handleRemoteEvent,
  });

  const visibleStartupIssue: VisibleTerminalStartupIssue | null =
    isRemoteTransport(transport)
      ? terminalStartupIssue(setupIssue ?? remoteIssue)
      : null;
  const startupIssueCode = (setupIssue ?? remoteIssue)?.code;

  const handleStartupAction = useCallback(async () => {
    if (!visibleStartupIssue || visibleStartupIssue.action === "settings") {
      return;
    }
    setSetupIssue(null);
    if (visibleStartupIssue.action === "retry") {
      // A restore can replace the Fly machine behind the same logical Brain
      // target. Start a fresh server session so Retry never reuses a stale
      // socket/session from the old machine.
      await retryRemote({ resetSession: true });
      return;
    }
    setSetupBusy(true);
    try {
      const response = await fetch("/api/kody/terminal/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason: startupIssueCode }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        const code = body.error ?? "terminal_setup_failed";
        setSetupIssue({
          code,
          message: body.message ?? "Terminal setup failed. Try again.",
          action:
            code === "fly_access_denied" || code === "fly_token_missing"
              ? "settings"
              : "setup",
        });
        return;
      }
      await retryRemote({ resetSession: true });
    } catch (error) {
      setSetupIssue({
        code: "terminal_setup_failed",
        message:
          error instanceof Error
            ? error.message
            : "Terminal setup failed. Try again.",
        action: "setup",
      });
    } finally {
      setSetupBusy(false);
    }
  }, [retryRemote, startupIssueCode, visibleStartupIssue]);

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      if (isRemoteTransport(transportRef.current)) {
        resizeRemote(cols, rows);
        return;
      }
      const current = localSessionRef.current;
      if (!current?.alive) return;
      void fetchWithTimeout(
        "/api/kody/chat/terminal/resize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ sessionId: current.sessionId, cols, rows }),
        },
        TERMINAL_RESIZE_TIMEOUT_MS,
      ).catch(() => {});
    },
    [resizeRemote],
  );

  const sendRawInput = useCallback(
    (input: string) => {
      if (isRemoteTransport(transportRef.current)) {
        const inputId = String(nextInputIdRef.current++);
        if (sendRemoteInput(inputId, input)) {
          setInputSignalBriefly(
            { tone: "sent", label: "Input sent" },
            { tone: "ready", label: "Ready for input" },
          );
        } else {
          setInputSignalBriefly(
            { tone: "blocked", label: "Input blocked" },
            { tone: "blocked", label: "Waiting for terminal" },
          );
        }
        return;
      }
      const current = localSessionRef.current;
      if (!current?.alive || localInputBlockedRef.current) {
        setInputSignalBriefly(
          { tone: "blocked", label: "Input blocked" },
          { tone: "blocked", label: "Input blocked" },
        );
        return;
      }
      setInputSignalBriefly(
        { tone: "sent", label: "Input sent" },
        { tone: "ready", label: "Ready for input" },
      );
      localInputQueueRef.current = localInputQueueRef.current.then(async () => {
        if (
          localSessionRef.current?.sessionId !== current.sessionId ||
          !localSessionRef.current.alive ||
          localInputBlockedRef.current
        )
          return;
        try {
          const response = await fetchWithTimeout(
            "/api/kody/chat/terminal/input",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({
                sessionId: current.sessionId,
                input,
                raw: true,
              }),
            },
            TERMINAL_INPUT_TIMEOUT_MS,
          );
          if (!response.ok)
            throw new Error(
              "Terminal input could not be delivered. Retry the terminal before typing again.",
            );
        } catch (error) {
          if (localSessionRef.current?.sessionId !== current.sessionId) return;
          localInputBlockedRef.current = true;
          setLocalError(
            error instanceof Error ? error.message : "Terminal input failed",
          );
          setInputSignal({ tone: "blocked", label: "Input blocked" });
        }
      });
    },
    [sendRemoteInput, setInputSignalBriefly],
  );

  const startLocal = useCallback(async () => {
    const view = viewRef.current;
    if (!view || startingLocalRef.current || localSessionRef.current?.alive)
      return;
    startingLocalRef.current = true;
    setConnectingLocal(true);
    setLocalError(null);
    setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
    try {
      view.fit();
      const size = view.getSize();
      const response = await fetchWithTimeout(
        "/api/kody/chat/terminal/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            chatSessionId,
            cols: size.cols,
            rows: size.rows,
          }),
        },
        TERMINAL_START_TIMEOUT_MS,
      );
      const body = (await response.json().catch(() => ({}))) as {
        session?: LocalTerminalSession;
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.session) {
        throw new Error(
          body.message ?? body.error ?? `HTTP ${response.status}`,
        );
      }
      sessionEndNotifiedRef.current = false;
      localSessionRef.current = body.session;
      localInputBlockedRef.current = false;
      setLocalSession(body.session);
      setInputSignal({ tone: "ready", label: "Ready for input" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start terminal";
      setLocalError(message);
      setInputSignal({ tone: "blocked", label: "Input blocked" });
    } finally {
      startingLocalRef.current = false;
      setConnectingLocal(false);
    }
  }, [chatSessionId]);

  const pollLocalOutput = useCallback(async () => {
    const current = localSessionRef.current;
    if (!current || pollBusyRef.current) return false;
    pollBusyRef.current = true;
    try {
      const params = new URLSearchParams({
        sessionId: current.sessionId,
        cursor: String(current.cursor),
        waitMs: String(LOCAL_OUTPUT_WAIT_MS),
      });
      const response = await fetchWithTimeout(
        `/api/kody/chat/terminal/output?${params}`,
        { headers: authHeaders() },
        LOCAL_OUTPUT_READ_TIMEOUT_MS,
      );
      const body = (await response.json().catch(() => ({}))) as {
        events?: LocalTerminalEvent[];
        cursor?: number;
        alive?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? `HTTP ${response.status}`);
      const next = {
        ...current,
        cursor: body.cursor ?? current.cursor,
        alive: body.alive ?? current.alive,
      };
      localSessionRef.current = next;
      setLocalSession(next);
      for (const event of body.events ?? []) {
        if (event.type === "output") {
          appendCapturedOutput(event.data);
          viewRef.current?.write(event.data);
        } else {
          viewRef.current?.writeln(
            `\r\nProcess exited${event.code === undefined ? "" : ` (${event.code})`}`,
          );
          notifySessionEnded();
        }
      }
      if (current.alive && !next.alive) notifySessionEnded();
      return true;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      pollBusyRef.current = false;
    }
  }, [appendCapturedOutput, notifySessionEnded]);

  useEffect(() => {
    if (!ready || !active || isRemoteTransport(transport)) return;
    viewRef.current?.fit();
    void startLocal();
  }, [active, ready, startLocal, transport]);

  useEffect(() => {
    if (!active || !localSession?.sessionId || isRemoteTransport(transport)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        if (!(await pollLocalOutput())) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, localSession?.sessionId, pollLocalOutput, transport]);

  const stop = useCallback(async () => {
    if (isRemoteTransport(transportRef.current)) {
      disconnectRemote();
      setInputSignal({ tone: "blocked", label: "Detached" });
      return;
    }
    const current = localSessionRef.current;
    if (!current) return;
    notifySessionEnded();
    localSessionRef.current = null;
    setLocalSession(null);
    setInputSignal({ tone: "blocked", label: "Input blocked" });
    await fetchWithTimeout(
      "/api/kody/chat/terminal/stop",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sessionId: current.sessionId }),
      },
      TERMINAL_STOP_TIMEOUT_MS,
    ).catch(() => {});
    viewRef.current?.writeln("\r\nTerminal stopped");
  }, [disconnectRemote, notifySessionEnded]);

  const canSendInput = useCallback(
    () =>
      isRemoteTransport(transportRef.current)
        ? remoteConnection === "connected" && remoteSession?.state === "ready"
        : Boolean(
            localSessionRef.current?.alive && !localInputBlockedRef.current,
          ),
    [remoteConnection, remoteSession?.state],
  );

  const sendText = useCallback(
    (text: string) => {
      const normalized = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n/g, "\r");
      if (!normalized.trim() || !canSendInput()) return false;
      sendRawInput(normalized.endsWith("\r") ? normalized : `${normalized}\r`);
      return true;
    },
    [canSendInput, sendRawInput],
  );

  const executeText = useCallback(
    (text: string) => {
      const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!normalized.trim() || !canSendInput()) return false;
      const executable = normalized.endsWith("\n")
        ? normalized
        : `${normalized}\n`;
      sendRawInput(executable.replace(/\n/g, "\r"));
      return true;
    },
    [canSendInput, sendRawInput],
  );

  const clear = useCallback(() => {
    outputCaptureRef.current = "";
    if (isRemoteTransport(transportRef.current)) {
      if (!clearRemote()) toast.error("Terminal is not connected yet");
    } else {
      viewRef.current?.clear();
    }
    viewRef.current?.focus();
  }, [clearRemote]);

  const restart = useCallback(() => {
    outputCaptureRef.current = "";
    setInputSignal({ tone: "blocked", label: "Waiting for terminal" });
    viewRef.current?.resetModes();
    if (isRemoteTransport(transportRef.current)) {
      if (!restartRemote()) toast.error("Terminal is not connected yet");
      return;
    }
    void stop().then(startLocal);
  }, [restartRemote, startLocal, stop]);

  const prepareForRuntimeChange = useCallback(() => {
    outputCaptureRef.current = "";
    viewRef.current?.clear();
    viewRef.current?.resetModes();
    if (isRemoteTransport(transportRef.current)) {
      disconnectRemote();
      setInputSignal({ tone: "blocked", label: "Brain is restarting" });
    }
  }, [disconnectRemote]);

  const reconnectFresh = useCallback(async () => {
    if (!isRemoteTransport(transportRef.current)) return;
    setInputSignal({ tone: "blocked", label: "Waiting for Brain" });
    await retryRemote({ resetSession: true });
  }, [retryRemote]);

  const addToChat = useCallback(() => {
    const text = usefulCapturedOutput(outputCaptureRef.current);
    if (!text.trim()) {
      toast.info("No terminal output to add yet");
      return;
    }
    onAddToChat(`## Terminal output\n\n\`\`\`\`text\n${text}\n\`\`\`\``);
  }, [onAddToChat]);

  useImperativeHandle(
    ref,
    () => ({
      sendLine: sendText,
      sendText,
      executeText,
      addToChat,
      clear,
      restart,
      stop,
      prepareForRuntimeChange,
      reconnectFresh,
      focus: () => viewRef.current?.focus(),
      getSnapshot,
    }),
    [
      addToChat,
      clear,
      executeText,
      getSnapshot,
      prepareForRuntimeChange,
      reconnectFresh,
      restart,
      sendText,
      stop,
    ],
  );

  const connection: ChatTerminalConnectionState = isRemoteTransport(transport)
    ? remoteConnection
    : localSession?.alive
      ? "connected"
      : connectingLocal
        ? "connecting"
        : localError
          ? "error"
          : "closed";
  const error = isRemoteTransport(transport) ? remoteError : localError;
  const statusText = isRemoteTransport(transport)
    ? (error ?? remoteRecovery?.message ??
      `${transport.label ?? (transport.type === "brain" ? "Brain terminal" : transport.app)} · ${connection}`)
    : (error ??
      (localSession?.alive
        ? localSession.cwd
        : connectingLocal
          ? "starting"
          : "closed"));
  const actionBusy = connection === "connecting" || connection === "restoring";

  useEffect(() => {
    onChromeStateChange?.({
      connection,
      statusText,
      inputLabel: inputSignal.label,
      inputTone: inputSignal.tone,
      actionBusy,
    });
  }, [actionBusy, connection, inputSignal, onChromeStateChange, statusText]);

  useEffect(
    () => () => {
      if (inputSignalTimerRef.current !== null) {
        window.clearTimeout(inputSignalTimerRef.current);
      }
    },
    [],
  );

  return (
    <TerminalView
      ref={viewRef}
      active={active}
      topToolbar={topToolbar}
      startupIssue={
        isRemoteTransport(transport)
          ? visibleStartupIssue
          : localError && (!localSession?.alive || localInputBlockedRef.current)
            ? {
                title: "Local terminal could not start",
                message: localError,
                action: "retry",
                actionLabel: "Retry terminal",
              }
            : null
      }
      recovery={isRemoteTransport(transport) ? remoteRecovery : null}
      startupActionBusy={
        isRemoteTransport(transport) ? setupBusy : connectingLocal
      }
      onStartupAction={() =>
        void (isRemoteTransport(transport)
          ? handleStartupAction()
          : stop().then(startLocal))
      }
      onData={sendRawInput}
      onResize={sendResize}
      onReady={handleViewReady}
    />
  );
});
