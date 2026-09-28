import type { Memory, MemoryContent, MemoryKind } from "@kody-ade/memory";

const MIN_MEANINGFUL_TOKENS = 4;
const DUPLICATE_TOKEN_OVERLAP = 0.8;

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(normalizedText(value).split(/\s+/).filter(Boolean));
}

function hasDuplicateMeaning(left: string, right: string): boolean {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize < MIN_MEANINGFUL_TOKENS) return false;

  let sharedTokens = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) sharedTokens += 1;
  }
  return sharedTokens / smallerSize >= DUPLICATE_TOKEN_OVERLAP;
}

function contentValues(content: Readonly<MemoryContent>): readonly string[] {
  return [content.title, content.summary, content.body];
}

export function findDuplicateMemory(
  candidates: readonly Readonly<Memory>[],
  incoming: Readonly<{
    kind: MemoryKind;
    content: Readonly<MemoryContent>;
  }>,
): Readonly<Memory> | null {
  const incomingValues = contentValues(incoming.content);
  return (
    candidates.find(
      (candidate) =>
        candidate.kind === incoming.kind &&
        contentValues(candidate.content).some((existingValue) =>
          incomingValues.some((incomingValue) =>
            hasDuplicateMeaning(existingValue, incomingValue),
          ),
        ),
    ) ?? null
  );
}
