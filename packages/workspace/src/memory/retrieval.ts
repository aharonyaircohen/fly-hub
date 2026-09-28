import type { Memory } from "@kody-ade/memory";
import { createMemoryRuntime, type MemoryRuntimeContext } from "./runtime";

const MAX_PROMPT_BODY = 2_000;

export function formatMemoryPrompt(
  memories: readonly Readonly<Memory>[],
): string | null {
  if (memories.length === 0) return null;
  const entries = memories.map((memory) => {
    const scope = memory.scope.kind === "user" ? "personal" : "repository";
    const body =
      memory.content.body.length > MAX_PROMPT_BODY
        ? `${memory.content.body.slice(0, MAX_PROMPT_BODY)}…`
        : memory.content.body;
    return [
      `### ${memory.content.title}`,
      `id: ${memory.id} | kind: ${memory.kind} | scope: ${scope}`,
      memory.content.summary,
      body,
    ].join("\n");
  });
  return ["## Relevant memory", ...entries].join("\n\n");
}

export async function loadRelevantMemoryForPrompt(
  context: Readonly<MemoryRuntimeContext>,
  query: string,
): Promise<string | null> {
  if (!query.trim()) return null;
  const runtime = createMemoryRuntime(context);
  const memories = await runtime.application.search({
    principal: runtime.principal,
    scopes: runtime.scopes,
    query,
    limit: 8,
  });
  return formatMemoryPrompt(memories);
}
