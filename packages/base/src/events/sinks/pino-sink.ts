/**
 * @fileType utility
 * @domain events
 * @pattern system-event-sink
 * @ai-summary Debug sink: writes every system event to the pino logger so
 *   local dev and log aggregation can observe the event stream.
 */
import "server-only";
import { logger } from "@kody-ade/base/logger";
import type { SystemEventSink } from "../types";

export const pinoSink: SystemEventSink = {
  name: "pino",
  async handle(events) {
    for (const event of events) {
      logger.debug({ event }, "system-event");
    }
  },
};
