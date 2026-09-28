/**
 * @fileType barrel
 * @domain events
 * @pattern system-events
 * @ai-summary Server barrel for the system-event backbone. Client code
 *   imports from `./client` / `./catalog` directly.
 */
export {
  emitSystemEvent,
  setEventFlushScheduler,
  type EmitContext,
  type EventFlushScheduler,
} from "./emit";
export {
  SYSTEM_EVENT_CATALOG,
  SYSTEM_EVENT_NAMES,
  isSystemEventName,
  type SystemEventName,
  type SystemEventPayload,
} from "./catalog";
export {
  registerSystemEventSink,
  getSystemEventSinks,
} from "./sink-registry";
export type {
  SystemEventEnvelope,
  SystemEventSink,
  SystemEventSinkContext,
  SystemEventSource,
  SystemEventBrand,
} from "./types";
