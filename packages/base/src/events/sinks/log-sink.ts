/**
 * @fileType utility
 * @domain events
 * @pattern system-event-sink
 * @ai-summary Durable sink: appends system events to a day-sharded Convex
 *   stream. Day
 *   sharding keeps entries bounded and lets analytics consume by date range.
 *   Best-effort: failures warn, never throw.
 */
import "server-only";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { logger } from "@kody-ade/base/logger";
import type { SystemEventEnvelope, SystemEventSink } from "../types";

/**
 * Only low-volume, high-value events are durably persisted. High-frequency
 * UI telemetry (page views, view shown/clicked) stays on the in-memory /
 * pino path. A proper analytics sink can pick those up separately.
 */
const DURABLE_EVENT_NAMES = new Set([
  "session.started",
  "session.ended",
  "chat.message.sent",
  "chat.response.completed",
  "auth.signed_in",
  "auth.signed_out",
  "model.save.proposed",
  "state.entity.written",
  "system.error",
]);

export function eventLogPath(occurredAt: string): string {
  const day = occurredAt.slice(0, 10);
  return `events/log/${day}.jsonl`;
}

export const durableLogSink: SystemEventSink = {
  name: "durable-log",
  async handle(events, ctx) {
    const withBrand = events.filter(
      (event): event is SystemEventEnvelope & {
        brand: { owner: string; repo: string };
      } => event.brand !== null && DURABLE_EVENT_NAMES.has(event.name),
    );
    if (withBrand.length === 0) return;

    // Group by brand + day shard so each file is written once per batch.
    const groups = new Map<string, SystemEventEnvelope[]>();
    for (const event of withBrand) {
      const key = `${event.brand.owner}/${event.brand.repo}:${eventLogPath(event.occurredAt)}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }

    for (const [key, group] of groups) {
      const { owner, repo } = group[0].brand as {
        owner: string;
        repo: string;
      };
      const path = eventLogPath(group[0].occurredAt);
      try {
        const client = createBackendClient();
        for (const event of group) {
          await client.mutation(api.dailyLogs.append, {
            tenantId: `${owner}/${repo}`,
            stream: "events",
            date: path.slice(-13, -5),
            entry: event,
          });
        }
      } catch (err) {
        logger.warn({ err, key }, "system-event durable sink failed");
      }
    }
  },
};
