import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import { v } from "convex/values";

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const rows = await ctx.db
      .query("viewRenderers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = latest.get(row.slug);
      if ((row.version ?? 1) >= (current?.version ?? 0)) {
        latest.set(row.slug, row);
      }
    }
    return [...latest.values()]
      .filter((row) => !row.archived)
      .map((row) => ({
        ...row,
        version: row.version ?? 1,
      }));
  },
});

export const save = mutation({
  args: {
    tenantId: v.string(),
    slug: v.string(),
    definition: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("viewRenderers")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("slug", args.slug),
      )
      .collect();
    const version =
      rows.reduce((latest, row) => Math.max(latest, row.version ?? 1), 0) + 1;
    await ctx.db.insert("viewRenderers", { ...args, version });
    return version;
  },
});

export const getVersion = query({
  args: { tenantId: v.string(), slug: v.string(), version: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("viewRenderers")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("slug", args.slug),
      )
      .collect();
    const row = rows.find(
      (candidate) => (candidate.version ?? 1) === args.version,
    );
    return row && !row.archived ? { ...row, version: row.version ?? 1 } : null;
  },
});

export const remove = mutation({
  args: { tenantId: v.string(), slug: v.string() },
  handler: async (ctx, { tenantId, slug }) => {
    const rows = await ctx.db
      .query("viewRenderers")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", tenantId).eq("slug", slug),
      )
      .collect();
    const latest = rows.reduce(
      (current, row) =>
        !current || (row.version ?? 1) > (current.version ?? 1) ? row : current,
      undefined as (typeof rows)[number] | undefined,
    );
    if (!latest || latest.archived) return;
    await ctx.db.insert("viewRenderers", {
      tenantId,
      slug,
      version: (latest.version ?? 1) + 1,
      archived: true,
      definition: latest.definition,
      updatedAt: new Date().toISOString(),
    });
  },
});
