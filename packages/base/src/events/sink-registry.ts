/**
 * @fileType utility
 * @domain events
 * @pattern system-event-sink-registry
 * @ai-summary Module-level registry of system-event sinks (listeners). The
 *   emitter fans every event out to all registered sinks; a throwing sink is
 *   isolated (logged, never breaks the others). Future consumers — triggers,
 *   analytics, workflows — plug in here without touching emitters.
 */
import "server-only";
import { logger } from "@kody-ade/base/logger";
import type {
  SystemEventEnvelope,
  SystemEventSink,
  SystemEventSinkContext,
} from "./types";

const sinks: SystemEventSink[] = [];

export function registerSystemEventSink(sink: SystemEventSink): void {
  if (sinks.some((existing) => existing.name === sink.name)) return;
  sinks.push(sink);
}

export function getSystemEventSinks(): readonly SystemEventSink[] {
  return sinks;
}

/** Exported for unit tests — clears all registered sinks. */
export function _resetSystemEventSinks(): void {
  sinks.length = 0;
}

/** Fan events out to every sink; a failing sink only warns. */
export async function dispatchToSinks(
  events: readonly SystemEventEnvelope[],
  ctx: SystemEventSinkContext,
): Promise<void> {
  await Promise.all(
    sinks.map(async (sink) => {
      try {
        await sink.handle(events, ctx);
      } catch (err) {
        logger.warn({ err, sink: sink.name }, "system-event sink failed");
      }
    }),
  );
}
