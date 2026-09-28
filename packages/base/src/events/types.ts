/**
 * @fileType types
 * @domain events
 * @pattern system-events
 * @ai-summary Shared types for the system-event backbone: the envelope every
 *   emitted event is wrapped in, the sink (listener) contract, and the emit
 *   context. Type-only module — safe to import from client code.
 */

/** Where the event originated. */
export type SystemEventSource = "server" | "client" | "model" | "system";

/** Brand (consumer repo) an event belongs to. */
export interface SystemEventBrand {
  owner: string;
  repo: string;
}

/**
 * The envelope every system event is wrapped in before reaching sinks.
 * Payload shape is defined per event name in the catalog.
 */
export interface SystemEventEnvelope<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  /** ISO timestamp of when the event occurred. */
  readonly occurredAt: string;
  /** Unified actor id, e.g. "operator:<login>" or "client:<email>". */
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly brand: SystemEventBrand | null;
  readonly source: SystemEventSource;
  readonly payload: P;
}

/**
 * A listener on the system-event stream. Future consumers (triggers,
 * analytics, workflows) implement this and register via the sink registry.
 */
export interface SystemEventSink {
  readonly name: string;
  handle(
    events: readonly SystemEventEnvelope[],
    ctx: SystemEventSinkContext,
  ): Promise<void>;
}

/** Context passed to sinks alongside the events. */
export interface SystemEventSinkContext {
  /** Octokit authenticated for the brand, when the emitter had one. */
  octokit: unknown | null;
}
