import {
  reduceTerminalSession,
  TerminalSessionTransitionError,
} from "@kody-ade/terminal/terminal-session-state";
import {
  TerminalEventSchema,
  type TerminalEvent,
  type TerminalSession,
  type TerminalSessionInput,
} from "@kody-ade/terminal/terminal-session-model";

import type {
  ChatTerminalConnectionState,
  ChatTerminalTransport,
} from "./types";

export interface TerminalClientSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface TerminalSessionResponse {
  webSocketUrl: string;
  session: TerminalSessionInput;
  expiresAt?: string;
}

export type TerminalStartupAction = "setup" | "settings" | "retry";

export interface TerminalStartupIssue {
  code: string;
  message: string;
  action: TerminalStartupAction;
}

export interface TerminalTransportRecovery {
  phase: "connecting" | "reconnecting" | "unavailable";
  message: string;
  attempt?: number;
  retryInMs?: number;
  details?: string;
}

export class TerminalSessionRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly action: TerminalStartupAction;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    action: TerminalStartupAction;
  }) {
    super(input.message);
    this.name = "TerminalSessionRequestError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.action = input.action;
  }
}

export interface TerminalSessionClientState {
  connection: ChatTerminalConnectionState;
  session: TerminalSession | null;
  error: string | null;
  issue: TerminalStartupIssue | null;
  recovery: TerminalTransportRecovery | null;
}

interface TerminalSessionClientOptions {
  chatSessionId: string;
  transport: Exclude<ChatTerminalTransport, { type: "local" }>;
  activityLimit: number | "never" | null;
  getSize: () => { cols: number; rows: number };
  requestSession: (
    body: Record<string, unknown>,
  ) => Promise<TerminalSessionResponse>;
  createSocket: (url: string) => TerminalClientSocket;
  schedule?: (callback: () => void, delayMs: number) => number;
  cancelSchedule?: (id: number) => void;
  onEvent?: (event: TerminalEvent) => void;
  onState?: (state: TerminalSessionClientState) => void;
}

export function shouldSendBrainActivityLimit(
  transport: Exclude<ChatTerminalTransport, { type: "local" }>,
): boolean {
  return (
    transport.type === "brain" ||
    (transport.type === "fly" &&
      (transport.feature === "brain" || transport.feature === undefined))
  );
}

const SOCKET_OPEN = 1;
const FAST_SUBSCRIPTION_RETRIES = 4;
const RETRY_BASE_MS = 750;
const RETRY_MAX_MS = 30_000;
const SUBSCRIPTION_READY_TIMEOUT_MS = 20_000;

function parseMessage(
  raw: string,
):
  | { kind: "event"; event: TerminalEvent }
  | { kind: "pong" }
  | { kind: "rejected"; code?: string; message: string }
  | { kind: "transport-status"; recovery: TerminalTransportRecovery }
  | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "pong") return { kind: "pong" };
    if (
      record.type === "transport-status" &&
      ["connecting", "reconnecting", "unavailable"].includes(
        String(record.phase),
      ) &&
      typeof record.message === "string"
    ) {
      return {
        kind: "transport-status",
        recovery: {
          phase: record.phase as TerminalTransportRecovery["phase"],
          message: record.message,
          ...(Number.isInteger(record.attempt)
            ? { attempt: Number(record.attempt) }
            : {}),
          ...(Number.isFinite(record.retryInMs)
            ? { retryInMs: Math.max(0, Number(record.retryInMs)) }
            : {}),
          ...(typeof record.details === "string"
            ? { details: record.details }
            : {}),
        },
      };
    }
    if (record.type === "input-rejected") {
      return {
        kind: "rejected",
        ...(typeof record.code === "string" ? { code: record.code } : {}),
        message:
          typeof record.message === "string"
            ? record.message
            : "Terminal input was rejected",
      };
    }
  }
  const parsed = TerminalEventSchema.safeParse(value);
  return parsed.success ? { kind: "event", event: parsed.data } : null;
}

export class TerminalSessionClient {
  private socket: TerminalClientSocket | null = null;
  private identity: TerminalSessionInput | null = null;
  private session: TerminalSession | null = null;
  private retryTimer: number | null = null;
  private readinessTimer: number | null = null;
  private retryCount = 0;
  private lastRetryReason: string | null = null;
  private connectSequence = 0;
  private stopped = false;
  private startupBlocked = false;
  private subscriptionReady = false;
  private startupLease: TerminalSessionResponse | null = null;
  private state: TerminalSessionClientState = {
    connection: "idle",
    session: null,
    error: null,
    issue: null,
    recovery: null,
  };

  constructor(private readonly options: TerminalSessionClientOptions) {}

  private schedule(callback: () => void, delayMs: number): number {
    return this.options.schedule
      ? this.options.schedule(callback, delayMs)
      : (globalThis.setTimeout(callback, delayMs) as unknown as number);
  }

  private cancelSchedule(id: number): void {
    if (this.options.cancelSchedule) this.options.cancelSchedule(id);
    else globalThis.clearTimeout(id);
  }

  private publish(
    connection: ChatTerminalConnectionState,
    error: string | null = null,
    issue: TerminalStartupIssue | null = null,
    recovery: TerminalTransportRecovery | null = null,
  ): void {
    this.state = { connection, session: this.session, error, issue, recovery };
    this.options.onState?.(this.state);
  }

  private requestBody(): Record<string, unknown> {
    const { cols, rows } = this.options.getSize();
    const base = {
      chatSessionId: this.options.chatSessionId,
      ...(this.session ? { afterRevision: this.session.revision } : {}),
      ...(shouldSendBrainActivityLimit(this.options.transport) &&
      this.options.activityLimit !== null
        ? {
            activityLimitMs:
              this.options.activityLimit === "never"
                ? null
                : this.options.activityLimit,
          }
        : {}),
      cols,
      rows,
    };
    const transport = this.options.transport;
    return transport.type === "brain"
      ? { target: "brain", ...base }
      : {
          app: transport.app,
          machineId: transport.machineId,
          feature: transport.feature,
          ...base,
        };
  }

  private reusableStartupLease(): TerminalSessionResponse | null {
    if (this.session || !this.startupLease?.expiresAt) return null;
    const expiresAt = Date.parse(this.startupLease.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > Date.now() + 5_000
      ? this.startupLease
      : null;
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    this.cancelSchedule(this.retryTimer);
    this.retryTimer = null;
  }

  private clearReadinessTimer(): void {
    if (this.readinessTimer === null) return;
    this.cancelSchedule(this.readinessTimer);
    this.readinessTimer = null;
  }

  private canRetry(): boolean {
    return (
      !this.stopped &&
      !this.startupBlocked &&
      this.session?.state !== "exited" &&
      this.session?.state !== "failed"
    );
  }

  private retry(reason: string): void {
    if (!this.canRetry() || this.retryTimer !== null) return;
    if (reason !== "network connection closed") this.lastRetryReason = reason;
    this.retryCount += 1;
    const slowRetry = this.retryCount > FAST_SUBSCRIPTION_RETRIES;
    this.publish("connecting", null, null, {
      phase: slowRetry ? "unavailable" : "reconnecting",
      message: slowRetry
        ? "Connection unavailable — retrying shortly"
        : "Reconnecting to Brain…",
      attempt: this.retryCount + 1,
    });
    const delayMs = Math.min(
      RETRY_MAX_MS,
      RETRY_BASE_MS * 2 ** Math.min(this.retryCount - 1, 6),
    );
    this.retryTimer = this.schedule(
      () => {
        this.retryTimer = null;
        void this.openSubscription();
      },
      delayMs,
    );
  }

  private applyEvent(event: TerminalEvent): void {
    if (!this.identity || event.sessionId !== this.identity.id) return;
    try {
      if (!this.session) {
        if (event.type !== "state") return;
        this.session = {
          ...this.identity,
          generation: event.generation,
          state: event.state,
          revision: 0,
        };
      } else {
        this.session = reduceTerminalSession(this.session, {
          type: "event",
          event,
        });
      }
    } catch (error) {
      if (error instanceof TerminalSessionTransitionError) {
        this.publish("error", error.message);
        return;
      }
      throw error;
    }

    this.options.onEvent?.(event);
    if (this.session.state === "ready") {
      this.retryCount = 0;
      this.lastRetryReason = null;
      this.publish("connected");
    } else if (this.session.state === "detached") {
      this.publish("connecting");
    } else if (this.session.state === "exited") {
      this.clearRetry();
      this.publish("closed");
    } else if (this.session.state === "failed") {
      this.clearRetry();
      this.publish("error", event.type === "failed" ? event.message : null);
    } else {
      this.publish("connecting");
    }
  }

  private async openSubscription(): Promise<void> {
    if (this.stopped) return;
    const sequence = ++this.connectSequence;
    this.publish("connecting");
    try {
      const response =
        this.reusableStartupLease() ??
        (await this.options.requestSession(this.requestBody()));
      if (this.stopped || sequence !== this.connectSequence) return;
      this.startupLease = response;
      if (this.identity && response.session.id !== this.identity.id) {
        throw new Error("Terminal service changed the session identity");
      }
      this.identity = response.session;
      const socket = this.options.createSocket(response.webSocketUrl);
      this.socket?.close(1000, "terminal subscription replaced");
      this.socket = socket;
      this.subscriptionReady = false;
      this.clearReadinessTimer();
      socket.onopen = () => {
        if (this.socket !== socket || this.stopped) return;
        const { cols, rows } = this.options.getSize();
        socket.send(
          JSON.stringify({
            type: "resize",
            sessionId: this.identity?.id,
            cols,
            rows,
          }),
        );
        this.readinessTimer = this.schedule(() => {
          this.readinessTimer = null;
          if (this.socket === socket && !this.subscriptionReady) {
            try {
              socket.close(1013, "terminal readiness timed out");
            } catch {
              // The retry below still runs when a socket implementation rejects close.
            }
            this.retry("terminal readiness timed out");
          }
        }, SUBSCRIPTION_READY_TIMEOUT_MS);
      };
      socket.onmessage = ({ data }) => {
        if (this.socket !== socket || this.stopped) return;
        const message = parseMessage(data);
        if (!message || message.kind === "pong") return;
        if (message.kind === "transport-status") {
          this.publish("connecting", null, null, message.recovery);
          return;
        }
        if (message.kind === "rejected") {
          if (message.code === "terminal_transport_unavailable") {
            this.retry(message.message);
            return;
          }
          if (
            /tunnel unavailable|timed? out|context deadline exceeded|ECONNRESET|ETIMEDOUT|network is unreachable|connection refused/i.test(
              message.message,
            )
          ) {
            this.retry(message.message);
            return;
          }
          if (!this.session) {
            if (message.code === "terminal_agent_missing") {
              this.startupBlocked = true;
              this.publish("error", message.message, {
                code: message.code,
                message: message.message,
                action: "setup",
              });
            } else {
              this.retry(message.message);
            }
          } else {
            this.publish(this.state.connection, message.message);
          }
          return;
        }
        if (message.event.type === "state") {
          if (message.event.state === "ready") {
            this.subscriptionReady = true;
            this.clearReadinessTimer();
          } else if (
            message.event.state === "failed" ||
            message.event.state === "exited"
          ) {
            this.subscriptionReady = false;
          }
        }
        this.applyEvent(message.event);
      };
      socket.onerror = () => {
        if (this.socket === socket) this.publish("connecting");
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.clearReadinessTimer();
        this.subscriptionReady = false;
        this.socket = null;
        this.retry("network connection closed");
      };
    } catch (error) {
      if (this.stopped || sequence !== this.connectSequence) return;
      if (error instanceof TerminalSessionRequestError && !error.retryable) {
        this.startupBlocked = true;
        this.publish("error", error.message, {
          code: error.code,
          message: error.message,
          action: error.action,
        });
        return;
      }
      this.retry(error instanceof Error ? error.message : String(error));
    }
  }

  connect(): Promise<void> {
    this.stopped = false;
    this.startupBlocked = false;
    this.subscriptionReady = false;
    this.lastRetryReason = null;
    this.clearRetry();
    return this.openSubscription();
  }

  retryNow(options: { resetSession?: boolean } = {}): Promise<void> {
    if (options.resetSession) {
      this.disconnect();
      this.identity = null;
      this.session = null;
      this.startupLease = null;
    }
    this.stopped = false;
    this.startupBlocked = false;
    this.retryCount = 0;
    this.lastRetryReason = null;
    this.clearRetry();
    return this.openSubscription();
  }

  disconnect(): void {
    this.stopped = true;
    this.connectSequence += 1;
    this.clearRetry();
    this.clearReadinessTimer();
    this.subscriptionReady = false;
    if (this.socket?.readyState === SOCKET_OPEN && this.identity) {
      this.socket.send(
        JSON.stringify({ type: "detach", sessionId: this.identity.id }),
      );
    }
    this.socket?.close(1000, "terminal view detached");
    this.socket = null;
    this.startupLease = null;
    this.publish("closed");
  }

  sendInput(inputId: string, data: string): boolean {
    if (
      this.socket?.readyState !== SOCKET_OPEN ||
      !this.identity ||
      !this.subscriptionReady ||
      this.session?.state !== "ready"
    ) {
      return false;
    }
    this.socket.send(
      JSON.stringify({
        type: "input",
        sessionId: this.identity.id,
        inputId,
        data,
      }),
    );
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (
      this.socket?.readyState !== SOCKET_OPEN ||
      !this.identity ||
      !this.subscriptionReady
    ) return false;
    this.socket.send(
      JSON.stringify({
        type: "resize",
        sessionId: this.identity.id,
        cols,
        rows,
      }),
    );
    return true;
  }

  clear(): boolean {
    if (
      this.socket?.readyState !== SOCKET_OPEN ||
      !this.identity ||
      !this.subscriptionReady ||
      this.session?.state !== "ready"
    )
      return false;
    this.socket.send(
      JSON.stringify({ type: "clear", sessionId: this.identity.id }),
    );
    return true;
  }

  restart(): boolean {
    if (
      this.socket?.readyState !== SOCKET_OPEN ||
      !this.identity ||
      !this.subscriptionReady ||
      !this.session
    ) {
      return false;
    }
    const command = { type: "restart" as const, sessionId: this.identity.id };
    try {
      this.session = reduceTerminalSession(this.session, {
        type: "command",
        command,
      });
    } catch (error) {
      if (error instanceof TerminalSessionTransitionError) {
        this.publish("error", error.message);
        return false;
      }
      throw error;
    }
    this.publish("connecting");
    this.socket.send(JSON.stringify(command));
    return true;
  }

  getState(): TerminalSessionClientState {
    return this.state;
  }
}
