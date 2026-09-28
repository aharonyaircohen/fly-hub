import type {
  Memory,
  MemoryKind,
  MemoryRevision,
} from "@dashboard/lib/api/memory";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "preference",
  "fact",
  "decision",
  "reference",
];

export type MemoryScopeFolder = "personal" | "repository";

export const MEMORY_SCOPE_FOLDERS: readonly MemoryScopeFolder[] = [
  "personal",
  "repository",
];

const MEMORY_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function scopeFolder(memory: Readonly<Memory>): MemoryScopeFolder {
  return memory.scope.kind === "user" ? "personal" : "repository";
}

function scopeLabel(memory: Readonly<Memory>): string {
  return memory.scope.kind === "user"
    ? `Personal — ${memory.scope.userId}`
    : `Repository — ${memory.scope.tenantId}`;
}

export function memoryFilePath(memory: Readonly<Memory>): string {
  return `${scopeFolder(memory)}/${memory.kind}/${memory.id}.md`;
}

export function memoryIdFromFilePath(path: string): string | null {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 3) return null;
  const [scope, kind, fileName] = parts;
  if (!MEMORY_SCOPE_FOLDERS.includes(scope as MemoryScopeFolder)) return null;
  if (!MEMORY_KINDS.includes(kind as MemoryKind)) return null;
  if (!fileName.endsWith(".md")) return null;
  const id = fileName.slice(0, -3);
  return MEMORY_ID.test(id) ? id : null;
}

export function filterMemories(
  memories: readonly Readonly<Memory>[],
  query: string,
): readonly Readonly<Memory>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return memories;
  return memories.filter((memory) => {
    const scope =
      memory.scope.kind === "user"
        ? memory.scope.userId
        : memory.scope.tenantId;
    return [
      memory.content.title,
      memory.content.summary,
      memory.content.body,
      memory.kind,
      memory.scope.kind,
      scope,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

function evidenceMarkdown(
  revisions: readonly Readonly<MemoryRevision>[],
): string {
  const evidence = revisions.flatMap((revision) => revision.evidence);
  if (evidence.length === 0) return "No evidence recorded.";
  return evidence
    .map((item) => {
      const conversation = item.conversationId
        ? `, conversation \`${item.conversationId}\``
        : "";
      const uri = item.uri ? `, ${item.uri}` : "";
      return `- ${item.source} — \`${item.id}\`${conversation}${uri}`;
    })
    .join("\n");
}

function historyMarkdown(
  revisions: readonly Readonly<MemoryRevision>[],
): string {
  if (revisions.length === 0) return "No revisions recorded.";
  return [...revisions]
    .reverse()
    .map(
      (revision, index) =>
        `### Revision ${revisions.length - index}\n\n` +
        `- **When:** ${revision.createdAt}\n` +
        `- **By:** ${revision.actor.kind} — \`${revision.actor.id}\`\n` +
        `- **Reason:** ${revision.reason}`,
    )
    .join("\n\n");
}

export function memoryMarkdown(
  memory: Readonly<Memory>,
  revisions: readonly Readonly<MemoryRevision>[],
): string {
  const expiration = memory.expiresAt
    ? `\n- **Expires:** ${memory.expiresAt}`
    : "";
  return [
    `# ${memory.content.title}`,
    "",
    `> ${memory.content.summary}`,
    "",
    memory.content.body,
    "",
    "## Memory details",
    "",
    `- **Kind:** ${titleCase(memory.kind)}`,
    `- **Scope:** ${scopeLabel(memory)}`,
    `- **Status:** ${titleCase(memory.status)}`,
    `- **Created:** ${memory.createdAt}`,
    `- **Updated:** ${memory.updatedAt}${expiration}`,
    "",
    "## Evidence",
    "",
    evidenceMarkdown(revisions),
    "",
    "## Revision history",
    "",
    historyMarkdown(revisions),
    "",
  ].join("\n");
}
