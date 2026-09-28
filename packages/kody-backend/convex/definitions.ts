import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const kind = v.union(
  v.literal("agent"),
  v.literal("capability"),
  v.literal("goal"),
  v.literal("implementation"),
  v.literal("asset"),
);
const source = v.union(v.literal("local"), v.literal("store"));

function assertIdentity(slug: string, version?: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug)) {
    throw new Error("definition slug is invalid");
  }
  if (version !== undefined && (!version.trim() || version.length > 160)) {
    throw new Error("definition version is invalid");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export const listCurrent = query({
  args: { tenantId: v.string(), kind },
  handler: async (ctx, { tenantId, kind }) =>
    await ctx.db
      .query("definitionHeads")
      .withIndex("by_key", (q) => q.eq("tenantId", tenantId).eq("kind", kind))
      .take(500),
});

export const getCurrent = query({
  args: { tenantId: v.string(), kind, slug: v.string() },
  handler: async (ctx, { tenantId, kind, slug }) => {
    assertIdentity(slug);
    return await ctx.db
      .query("definitionHeads")
      .withIndex("by_key", (q) =>
        q.eq("tenantId", tenantId).eq("kind", kind).eq("slug", slug),
      )
      .unique();
  },
});

export const getVersion = query({
  args: { tenantId: v.string(), kind, slug: v.string(), version: v.string() },
  handler: async (ctx, { tenantId, kind, slug, version }) => {
    assertIdentity(slug, version);
    return await ctx.db
      .query("definitionVersions")
      .withIndex("by_version", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("kind", kind)
          .eq("slug", slug)
          .eq("version", version),
      )
      .unique();
  },
});

export const listVersions = query({
  args: { tenantId: v.string(), kind, slug: v.string() },
  handler: async (ctx, { tenantId, kind, slug }) => {
    assertIdentity(slug);
    return await ctx.db
      .query("definitionVersions")
      .withIndex("by_definition", (q) =>
        q.eq("tenantId", tenantId).eq("kind", kind).eq("slug", slug),
      )
      .order("desc")
      .take(100);
  },
});

export const publish = mutation({
  args: {
    tenantId: v.string(),
    kind,
    slug: v.string(),
    version: v.string(),
    bundle: v.any(),
    source: v.optional(source),
    createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    assertIdentity(args.slug, args.version);
    const existingVersion = await ctx.db
      .query("definitionVersions")
      .withIndex("by_version", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("kind", args.kind)
          .eq("slug", args.slug)
          .eq("version", args.version),
      )
      .unique();
    if (
      existingVersion &&
      canonicalJson(existingVersion.bundle) !== canonicalJson(args.bundle)
    ) {
      throw new Error("definition version is immutable");
    }
    if (!existingVersion) await ctx.db.insert("definitionVersions", args);

    const current = await ctx.db
      .query("definitionHeads")
      .withIndex("by_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("kind", args.kind)
          .eq("slug", args.slug),
      )
      .unique();
    const head = {
      tenantId: args.tenantId,
      kind: args.kind,
      slug: args.slug,
      version: args.version,
      bundle: args.bundle,
      source: args.source ?? "local",
      updatedAt: args.createdAt,
    };
    if (current) {
      await ctx.db.replace(current._id, head);
      return current._id;
    }
    return await ctx.db.insert("definitionHeads", head);
  },
});

export const retire = mutation({
  args: { tenantId: v.string(), kind, slug: v.string() },
  handler: async (ctx, { tenantId, kind, slug }) => {
    assertIdentity(slug);
    const current = await ctx.db
      .query("definitionHeads")
      .withIndex("by_key", (q) =>
        q.eq("tenantId", tenantId).eq("kind", kind).eq("slug", slug),
      )
      .unique();
    if (current) await ctx.db.delete(current._id);
  },
});
