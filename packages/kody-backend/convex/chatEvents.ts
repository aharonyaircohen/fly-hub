import { query } from "./_generated/server"
import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./lib/auth"

export const append = serviceMutation({
  args: {
    tenantId: v.string(),
    sessionId: v.string(),
    event: v.any(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, sessionId, event, idempotencyKey }) => {
    const eventRunId =
      event &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      typeof (event as Record<string, unknown>).runId === "string"
        ? ((event as Record<string, unknown>).runId as string).trim()
        : ""
    const effectiveIdempotencyKey = idempotencyKey?.trim() || eventRunId
    if (effectiveIdempotencyKey) {
      const existing = await ctx.db
        .query("chatEvents")
        .withIndex("by_idempotency", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("sessionId", sessionId)
            .eq("idempotencyKey", effectiveIdempotencyKey),
        )
        .unique()
      if (existing) return existing._id
    }
    const last = await ctx.db
      .query("chatEvents")
      .withIndex("by_session", (q) => q.eq("tenantId", tenantId).eq("sessionId", sessionId))
      .order("desc")
      .first()
    const seq = (last?.seq ?? -1) + 1
    return await ctx.db.insert("chatEvents", {
      tenantId,
      sessionId,
      seq,
      event,
      ...(effectiveIdempotencyKey
        ? { idempotencyKey: effectiveIdempotencyKey }
        : {}),
    })
  },
})

// Most recently active session ids for a tenant, newest first — the Activity
// feed merges the last few sessions' events into one list. Scans the newest
// `scan` events via the by_tenant index (implicit _creationTime ordering)
// and dedupes their session ids.
export const recentSessions = serviceQuery({
  args: { tenantId: v.string(), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) => {
    const cappedLimit = Math.max(1, Math.min(limit, 50))
    const scan = Math.min(cappedLimit * 100, 2000)
    const recent = await ctx.db
      .query("chatEvents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(scan)
    const sessions: string[] = []
    for (const doc of recent) {
      if (!sessions.includes(doc.sessionId)) {
        sessions.push(doc.sessionId)
        if (sessions.length >= cappedLimit) break
      }
    }
    return sessions
  },
})

// Reactive tail of a session's event stream — the UI subscribes with the last
// seq it has and receives new events as they land.
//
// DELIBERATELY PUBLIC (no requireServiceKey): the browser subscribes to this
// via ConvexProvider (useChatEventsLive) and cannot carry the service secret.
// It exposes exactly what the polled /api/kody/events endpoints already
// served — session event payloads scoped by (tenantId, sessionId). The
// optional serviceKey arg is accepted and ignored so the auto-injecting
// server client can call it too.
export const since = query({
  args: {
    tenantId: v.string(),
    sessionId: v.string(),
    afterSeq: v.number(),
    serviceKey: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, sessionId, afterSeq }) => {
    return await ctx.db
      .query("chatEvents")
      .withIndex("by_session", (q) =>
        q.eq("tenantId", tenantId).eq("sessionId", sessionId).gt("seq", afterSeq),
      )
      .take(1000) // rate-bound: tail reads page in ascending seq order
  },
})
