/** Client orchestration for automatic conversation compaction. */
"use client";

import { useEffect, useState } from "react";
import {
  buildConversationContext,
  createConversationCheckpoint,
  planConversationCompaction,
  type CompactableMessage,
  type ConversationCheckpoint,
} from "../chat/core/conversation-compaction";

export type CompactionStatus = "compacting" | "compacted" | null;

/**
 * Hard deadline on the pre-turn summarization call. Compaction runs BEFORE
 * the turn's transport (and outside any turn watchdog), so a hung
 * /compact request would present as the whole chat hanging. On timeout the
 * catch below falls back to sending the turn uncompacted.
 */
export const COMPACTION_TIMEOUT_MS = 60_000;

export function useCompactionStatus(activeSessionId?: string) {
  const [status, setStatus] = useState<CompactionStatus>(null);

  useEffect(() => {
    if (status !== "compacted") return;
    const timeout = setTimeout(() => setStatus(null), 3_000);
    return () => clearTimeout(timeout);
  }, [status]);
  useEffect(() => setStatus(null), [activeSessionId]);

  return { compactionStatus: status, setCompactionStatus: setStatus };
}

interface CompactConversationForTurnArgs {
  messages: CompactableMessage[];
  checkpoint?: ConversationCheckpoint | null;
  nextUserContent: string;
  force?: boolean;
  model?: string | null;
  headers?: Record<string, string>;
  triggerTokens?: number;
  recentTokens?: number;
  fetchImpl?: typeof fetch;
  onStatus: (status: CompactionStatus) => void;
  onCheckpoint: (checkpoint: ConversationCheckpoint) => void;
}

export async function compactConversationForTurn(
  args: CompactConversationForTurnArgs,
): Promise<{
  context: ReturnType<typeof buildConversationContext>;
  didCompact: boolean;
}> {
  const currentContext = buildConversationContext(
    args.messages,
    args.checkpoint,
  );
  const plan = planConversationCompaction({
    messages: args.messages,
    checkpoint: currentContext.checkpoint,
    nextUserContent: args.nextUserContent,
    force: args.force,
    triggerTokens: args.triggerTokens,
    recentTokens: args.recentTokens,
  });
  if (!plan) return { context: currentContext, didCompact: false };

  args.onStatus("compacting");
  try {
    const response = await (args.fetchImpl ?? fetch)("/api/kody/chat/compact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.headers ?? {}),
      },
      body: JSON.stringify({
        ...(plan.previousSummary
          ? { previousSummary: plan.previousSummary }
          : {}),
        messages: plan.messagesToSummarize,
        ...(args.model ? { model: args.model } : {}),
      }),
      signal: AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { summary?: unknown };
    if (typeof body.summary !== "string" || !body.summary.trim()) {
      throw new Error("Missing summary");
    }

    const checkpoint = createConversationCheckpoint({
      summary: body.summary,
      messages: args.messages,
      throughMessageCount: plan.throughMessageCount,
      previousRevision: plan.previousRevision,
    });
    args.onCheckpoint(checkpoint);
    args.onStatus("compacted");
    return {
      context: buildConversationContext(args.messages, checkpoint),
      didCompact: true,
    };
  } catch {
    args.onStatus(null);
    return { context: currentContext, didCompact: false };
  }
}
