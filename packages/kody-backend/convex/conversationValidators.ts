import { v } from "convex/values";

export const agentIdentityValidator = v.object({
  slug: v.string(),
  title: v.string(),
});

export const conversationScopeValidator = v.union(
  v.object({ kind: v.literal("global") }),
  v.object({
    kind: v.literal("repository"),
    owner: v.string(),
    repo: v.string(),
  }),
);

export const conversationRuntimeValidator = v.union(
  v.object({ kind: v.literal("direct"), modelId: v.string() }),
  v.object({ kind: v.literal("brain"), brainId: v.string() }),
  v.object({ kind: v.literal("engine"), profileId: v.string() }),
  v.object({ kind: v.literal("live"), profileId: v.string() }),
);

export const machineAccessValidator = v.union(
  v.literal("none"),
  v.literal("local"),
  v.literal("brain"),
);

export const conversationTurnProgressValidator = v.object({
  reasoning: v.string(),
  toolCalls: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.any(),
      description: v.optional(v.string()),
      activityKind: v.optional(v.literal("subagent")),
      displayName: v.optional(v.string()),
      status: v.union(
        v.literal("running"),
        v.literal("success"),
        v.literal("error"),
      ),
    }),
  ),
});

export const conversationTurnRecoveryValidator = v.object({
  kind: v.literal("project-assessment-synthesis"),
  version: v.literal(1),
  system: v.string(),
  userMessage: v.string(),
  internalLinks: v.array(v.object({ href: v.string(), label: v.string() })),
  repository: v.object({ owner: v.string(), repo: v.string() }),
  createdAt: v.string(),
});

export const conversationAuthorValidator = v.union(
  v.object({ kind: v.literal("user"), actorId: v.string() }),
  v.object({
    kind: v.literal("agent"),
    slug: v.string(),
    title: v.string(),
  }),
);

export const conversationEntryValidator = v.union(
  v.object({
    kind: v.literal("message"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    author: conversationAuthorValidator,
    content: v.string(),
    view: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("committed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    turnId: v.string(),
    attachmentIds: v.optional(v.array(v.string())),
    createdAt: v.string(),
  }),
  v.object({
    kind: v.literal("agent-handoff"),
    from: agentIdentityValidator,
    to: agentIdentityValidator,
    createdAt: v.string(),
  }),
);

export const conversationAttachmentValidator = v.object({
  attachmentId: v.string(),
  entryId: v.string(),
  storageId: v.string(),
  fileName: v.string(),
  mediaType: v.string(),
  sizeBytes: v.number(),
  createdAt: v.string(),
});
