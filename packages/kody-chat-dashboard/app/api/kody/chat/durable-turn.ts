import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export type DurableTurnBackend = "direct" | "brain" | "engine" | "live";

export type DurableTurnIdentity = Readonly<{
  tenantId: string;
  conversationId: string;
  turnId: string;
  backend: DurableTurnBackend;
  agent: Readonly<{ slug: string; title: string }>;
  createIfMissing?: Readonly<{
    owner?: string;
    repo?: string;
    modelId: string;
    createdBy: string;
  }>;
}>;

export type DurableTurnProgress = Readonly<{
  reasoning: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    description?: string;
    activityKind?: "subagent";
    displayName?: string;
    status: "running" | "success" | "error";
  }>;
}>;

export type ProjectAssessmentSynthesisRecovery = Readonly<{
  kind: "project-assessment-synthesis";
  version: 1;
  system: string;
  userMessage: string;
  internalLinks: Array<{ href: string; label: string }>;
  repository: { owner: string; repo: string };
  createdAt: string;
}>;

export type DurableTurn = Readonly<{
  started: Promise<void>;
  recordProgress(progress: DurableTurnProgress): void;
  saveRecovery(recovery: ProjectAssessmentSynthesisRecovery): Promise<void>;
  complete(content: string): Promise<void>;
  fail(errorCode: string, errorDetail?: string): Promise<void>;
}>;

export type DurableTurnOptions = Readonly<{
  onProgressError?: (error: unknown) => void;
}>;

function isConversationGoneError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("conversation not found")
  );
}

/**
 * Starts persistence without delaying provider dispatch. Completion and failure
 * await that start, preserving ordering while the model and Convex run in
 * parallel.
 */
export function startDurableTurn(
  identity: DurableTurnIdentity,
  options: DurableTurnOptions = {},
): DurableTurn {
  const client = createBackendClient();
  const started = client
    .mutation(backendApi.conversationTurns.start, {
      ...identity,
      startedAt: new Date().toISOString(),
    })
    .then(() => undefined);
  // Completion/failure still observes and reports this rejection. Attaching a
  // handler now prevents a long model turn from producing an unhandled promise.
  void started.catch(() => undefined);

  let latestProgress: DurableTurnProgress | undefined;
  let progressVersion = 0;
  let queuedVersion = 0;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let progressWrites: Promise<void> = Promise.resolve();

  const queueProgressWrite = () => {
    if (!latestProgress || queuedVersion >= progressVersion) {
      return progressWrites;
    }
    const snapshot = latestProgress;
    queuedVersion = progressVersion;
    progressWrites = progressWrites
      .catch(() => undefined)
      .then(async () => {
        await started;
        await client.mutation(backendApi.conversationTurns.updateProgress, {
          tenantId: identity.tenantId,
          conversationId: identity.conversationId,
          turnId: identity.turnId,
          progress: snapshot,
          updatedAt: new Date().toISOString(),
        });
      })
      .catch((error: unknown) => {
        if (!isConversationGoneError(error)) options.onProgressError?.(error);
      });
    return progressWrites;
  };

  const flushProgress = async () => {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = undefined;
    }
    await queueProgressWrite();
  };

  return {
    started,
    recordProgress(progress) {
      latestProgress = progress;
      progressVersion += 1;
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = undefined;
          void queueProgressWrite();
        }, 250);
      }
    },
    async saveRecovery(recovery) {
      await started;
      await client.mutation(backendApi.conversationTurns.saveRecovery, {
        tenantId: identity.tenantId,
        conversationId: identity.conversationId,
        turnId: identity.turnId,
        recovery,
        updatedAt: new Date().toISOString(),
      });
    },
    async complete(content) {
      try {
        await started;
        await flushProgress();
        await client.mutation(backendApi.conversationTurns.complete, {
          tenantId: identity.tenantId,
          conversationId: identity.conversationId,
          turnId: identity.turnId,
          content,
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (!isConversationGoneError(error)) throw error;
      }
    },
    async fail(errorCode, errorDetail) {
      try {
        await started;
        await flushProgress();
        await client.mutation(backendApi.conversationTurns.fail, {
          tenantId: identity.tenantId,
          conversationId: identity.conversationId,
          turnId: identity.turnId,
          errorCode,
          ...(errorDetail ? { errorDetail } : {}),
          failedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (!isConversationGoneError(error)) throw error;
      }
    },
  };
}
