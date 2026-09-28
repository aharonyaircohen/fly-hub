# System events (`@kody-ade/base/events`)

The hardcoded event backbone: a catalog of namespaced events with versioned
Zod payload schemas, one fire-and-forget `emitSystemEvent()` path, and a sink
registry that consumers (durable log, and later triggers / analytics /
workflows) plug into. Brands never add events — configuration only references
catalog names.

- `catalog.ts` — every event + schema (client-safe, no `server-only`)
- `emit.ts` — the single emit path (server-only, validates then fans out via `after()`)
- `sink-registry.ts` — listener registration; a failing sink never breaks others
- `sinks/` — `pino-sink` (debug log) and `log-sink` (day-sharded JSONL in the
  brand backend; only low-volume events are durably persisted)
- `client.ts` + `PageViewTracker.tsx` — browser tracker, batching to
  `POST /api/kody/system-events` (identity is resolved server-side)

## Not to be confused with the engine chat bus

The dashboard host's `events/{ingest,poll,stream}` routes and
`chat-event-bus` are a **separate, intentional** system: an ephemeral
per-session stream that carries engine chat output (`chat.ready`,
`chat.done`, …) to the UI in real time. It is not part of this catalog and
should not be migrated onto it — the two serve different lifetimes
(streaming transport vs. durable product telemetry).
