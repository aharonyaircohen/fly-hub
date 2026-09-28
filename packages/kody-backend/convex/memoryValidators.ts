import { v } from "convex/values";

export const memoryScopeValidator = v.union(
  v.object({
    kind: v.literal("user"),
    userId: v.string(),
  }),
  v.object({
    kind: v.literal("repository"),
    tenantId: v.string(),
  }),
);

export const memoryKindValidator = v.union(
  v.literal("preference"),
  v.literal("fact"),
  v.literal("decision"),
  v.literal("reference"),
);

// Goal was a historical storage kind. Keep old rows valid while the public
// memory contract continues to accept only the current typed kinds above.
export const storedMemoryKindValidator = v.union(
  memoryKindValidator,
  v.literal("goal"),
);

export const memoryStatusValidator = v.union(
  v.literal("active"),
  v.literal("superseded"),
  v.literal("expired"),
);

export const memoryContentValidator = v.object({
  title: v.string(),
  summary: v.string(),
  body: v.string(),
});

export const memoryValidator = v.object({
  id: v.string(),
  scope: memoryScopeValidator,
  kind: memoryKindValidator,
  content: memoryContentValidator,
  currentRevisionId: v.string(),
  status: memoryStatusValidator,
  createdAt: v.string(),
  updatedAt: v.string(),
  expiresAt: v.optional(v.string()),
});

export const memoryEvidenceValidator = v.object({
  source: v.union(
    v.literal("user-input"),
    v.literal("conversation"),
    v.literal("message"),
    v.literal("pull-request"),
    v.literal("document"),
    v.literal("engine-run"),
  ),
  id: v.string(),
  conversationId: v.optional(v.string()),
  uri: v.optional(v.string()),
});

export const memoryActorValidator = v.object({
  kind: v.union(
    v.literal("user"),
    v.literal("system"),
    v.literal("engine"),
  ),
  id: v.string(),
});

export const memoryRevisionValidator = v.object({
  id: v.string(),
  memoryId: v.string(),
  previousRevisionId: v.union(v.string(), v.null()),
  kind: memoryKindValidator,
  content: memoryContentValidator,
  evidence: v.array(memoryEvidenceValidator),
  reason: v.string(),
  actor: memoryActorValidator,
  createdAt: v.string(),
});
