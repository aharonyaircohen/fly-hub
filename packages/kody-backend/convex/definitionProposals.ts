import { v, type Infer } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import { workflowDefinitionValidator } from "./validators";

type DefinitionKind = "agent" | "capability";
type ProposalFile = { path: string; content: string };

function proposalKind(proposalId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,159}$/.test(proposalId)) {
    throw new Error("proposal id is invalid");
  }
  return `definition-proposal:${proposalId}`;
}

function proposalDoc(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("proposal document is invalid");
  }
  return value as Record<string, unknown>;
}

function proposalFiles(value: unknown): ProposalFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("proposal files are invalid");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("proposal file is invalid");
    }
    const file = item as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("proposal file is invalid");
    }
    return { path: file.path, content: file.content };
  });
}

function definitionTarget(
  path: string,
): { kind: DefinitionKind; slug: string; relativePath: string } | null {
  let match = /^agents\/([a-z0-9][a-z0-9_-]{0,127})\.md$/.exec(path);
  if (match)
    return { kind: "agent", slug: match[1]!, relativePath: "agent.md" };
  match = /^capabilities\/([a-z0-9][a-z0-9_-]{0,127})\/(.+)$/.exec(path);
  if (match) {
    const relativePath = match[2]!;
    if (
      relativePath !== "instructions.md" &&
      relativePath !== "contract.json" &&
      !relativePath.startsWith("skills/") &&
      !relativePath.startsWith("tools/")
    ) {
      throw new Error(`unsupported Capability path: ${path}`);
    }
    return { kind: "capability", slug: match[1]!, relativePath };
  }
  return null;
}

function assertSafeRelativePath(path: string): void {
  const parts = path.split("/");
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("proposal file path is unsafe");
  }
}

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("repoDocs")
      .withIndex("by_kind", (q) =>
        q
          .eq("tenantId", tenantId)
          .gte("kind", "definition-proposal:")
          .lt("kind", "definition-proposal:￿"),
      )
      .take(100),
});

export const decide = mutation({
  args: {
    tenantId: v.string(),
    proposalId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    decidedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("repoDocs")
      .withIndex("by_kind", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("kind", proposalKind(args.proposalId)),
      )
      .unique();
    if (!record) throw new Error("definition proposal not found");
    const proposal = proposalDoc(record.doc);
    if (proposal.status !== "pending-review")
      throw new Error("definition proposal was already decided");

    if (args.decision === "approve") {
      const bundles = new Map<
        string,
        { kind: DefinitionKind; slug: string; files: Record<string, string> }
      >();
      for (const file of proposalFiles(proposal.files)) {
        const workflow = /^workflows\/([a-z0-9][a-z0-9_-]{0,127})\.json$/.exec(
          file.path,
        );
        if (workflow) {
          const definition = JSON.parse(file.content) as Infer<
            typeof workflowDefinitionValidator
          >;
          const existing = await ctx.db
            .query("workflows")
            .withIndex("by_tenant", (q) =>
              q.eq("tenantId", args.tenantId).eq("workflowId", workflow[1]!),
            )
            .unique();
          const next = {
            tenantId: args.tenantId,
            workflowId: workflow[1]!,
            definition,
            source: "local" as const,
            updatedAt: args.decidedAt,
          };
          if (existing) await ctx.db.replace(existing._id, next);
          else await ctx.db.insert("workflows", next);
          continue;
        }
        const target = definitionTarget(file.path);
        if (!target) throw new Error(`unsupported proposal path: ${file.path}`);
        assertSafeRelativePath(target.relativePath);
        const key = `${target.kind}:${target.slug}`;
        const bundle = bundles.get(key) ?? {
          kind: target.kind,
          slug: target.slug,
          files: {},
        };
        if (bundle.files[target.relativePath] !== undefined)
          throw new Error(`duplicate proposal path: ${file.path}`);
        bundle.files[target.relativePath] = file.content.replace(
          /\r\n?/g,
          "\n",
        );
        bundles.set(key, bundle);
      }

      for (const bundle of bundles.values()) {
        const definitionBundle = {
          schemaVersion: 1 as const,
          files: bundle.files,
        };
        const version = `proposal:${args.proposalId}`;
        const existingVersion = await ctx.db
          .query("definitionVersions")
          .withIndex("by_version", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("kind", bundle.kind)
              .eq("slug", bundle.slug)
              .eq("version", version),
          )
          .unique();
        if (!existingVersion) {
          await ctx.db.insert("definitionVersions", {
            tenantId: args.tenantId,
            kind: bundle.kind,
            slug: bundle.slug,
            version,
            bundle: definitionBundle,
            source: "local",
            createdAt: args.decidedAt,
          });
        }
        const current = await ctx.db
          .query("definitionHeads")
          .withIndex("by_key", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("kind", bundle.kind)
              .eq("slug", bundle.slug),
          )
          .unique();
        const head = {
          tenantId: args.tenantId,
          kind: bundle.kind,
          slug: bundle.slug,
          version,
          bundle: definitionBundle,
          source: "local" as const,
          updatedAt: args.decidedAt,
        };
        if (current) await ctx.db.replace(current._id, head);
        else await ctx.db.insert("definitionHeads", head);
      }
    }

    const status = args.decision === "approve" ? "approved" : "rejected";
    await ctx.db.patch(record._id, {
      doc: { ...proposal, status, decidedAt: args.decidedAt },
      updatedAt: args.decidedAt,
    });
    return { proposalId: args.proposalId, status };
  },
});
