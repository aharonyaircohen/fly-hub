import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

// Global (cross-tenant) engine event log — replaces event-log.jsonl in the
// legacy GitHub-backed Dashboard store, including its trim-to-cap behavior.

const EVENT_LOG_CAP = 10_000

export const append = mutation({
  args: {
    entryId: v.string(),
    runId: v.string(),
    event: v.string(),
    payload: v.any(),
    channel: v.optional(v.string()),
    emittedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("eventLog", args)
    const oldest = await ctx.db
      .query("eventLog")
      .withIndex("by_emitted")
      .order("asc")
      .take(EVENT_LOG_CAP + 100)
    if (oldest.length > EVENT_LOG_CAP) {
      for (const doc of oldest.slice(0, oldest.length - EVENT_LOG_CAP)) {
        await ctx.db.delete(doc._id)
      }
    }
    return id
  },
})

export const forRun = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("eventLog")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect()
  },
})

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("eventLog")
      .withIndex("by_emitted")
      .order("desc")
      .take(Math.min(limit ?? 100, 1000))
  },
})
