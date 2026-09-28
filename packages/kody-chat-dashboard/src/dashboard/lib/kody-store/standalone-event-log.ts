/** Standalone package runtime's Convex-backed append-only Kody event log. */
import type { Octokit } from "@octokit/rest"
import { api } from "@kody-ade/backend/api"
import { createBackendClient } from "@kody-ade/backend/client"

export interface EventLogEntry {
  id: string
  runId: string
  event: string
  payload: Record<string, unknown>
  channel?: string
  actionState?: { status: string; step: string; sessionId?: string }
  emittedAt: string
}

export interface EventLogOpts {
  owner?: string
  repo?: string
  branch?: string
  octokit?: Octokit | null
}

interface EventLogDoc {
  entryId: string
  runId: string
  event: string
  payload: Record<string, unknown>
  channel?: string
  emittedAt: string
}

const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const fromDoc = (doc: EventLogDoc): EventLogEntry => ({
  id: doc.entryId,
  runId: doc.runId,
  event: doc.event,
  payload: doc.payload,
  ...(doc.channel ? { channel: doc.channel } : {}),
  emittedAt: doc.emittedAt,
})

export async function logEvent(
  event: string,
  payload: Record<string, unknown>,
  actionState?: EventLogEntry["actionState"],
  channel = "pipeline",
  _opts: EventLogOpts = {},
): Promise<EventLogEntry> {
  const entry: EventLogEntry = {
    id: id(),
    runId: (payload.runId as string) ?? "unknown",
    event,
    payload,
    actionState,
    channel,
    emittedAt: new Date().toISOString(),
  }
  await createBackendClient().mutation(api.eventLog.append, {
    entryId: entry.id,
    runId: entry.runId,
    event: entry.event,
    payload: entry.payload,
    channel: entry.channel,
    emittedAt: entry.emittedAt,
  })
  return entry
}

export async function getEventHistory(runId: string, _opts: EventLogOpts = {}): Promise<EventLogEntry[]> {
  const docs = (await createBackendClient().query(api.eventLog.forRun, { runId })) as EventLogDoc[]
  return docs.map(fromDoc)
}

export async function getAllEvents(_opts: EventLogOpts = {}): Promise<EventLogEntry[]> {
  const docs = (await createBackendClient().query(api.eventLog.recent, { limit: 1000 })) as EventLogDoc[]
  return docs.map(fromDoc)
}

export async function getLastEvent(runId: string, opts: EventLogOpts = {}): Promise<EventLogEntry | null> {
  const history = await getEventHistory(runId, opts)
  return history.at(-1) ?? null
}
