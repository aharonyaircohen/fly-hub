/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-service
 * @ai-summary The one user-state API features call: `getUserState` /
 *   `setUserState`. Resolves the namespace, applies the merge policy,
 *   validates against the namespace schema (typed UserStateError on
 *   failure), writes through the bound adapter, and emits
 *   `state.entity.written` on every successful write.
 */
import "server-only";
import { emitSystemEvent, type SystemEventSource } from "@kody-ade/base/events";
import { getUserStateAdapter } from "./adapters";
import { getUserStateNamespace } from "./config";
import {
  UserStateError,
  type UserStateAdapterContext,
  type UserStateDoc,
} from "./types";

export interface UserStateServiceContext extends UserStateAdapterContext {
  /** Unified actor id, e.g. "operator:<login>" / "client:<email>". */
  userId: string;
  sessionId?: string | null;
}

export async function getUserState(
  ctx: UserStateServiceContext,
  namespaceName: string,
): Promise<UserStateDoc | null> {
  const namespace = await getUserStateNamespace(
    ctx.octokit,
    ctx.owner,
    ctx.repo,
    namespaceName,
  );
  if (!namespace) {
    throw new UserStateError(
      "namespace_not_found",
      `Unknown user-state namespace "${namespaceName}"`,
    );
  }
  const adapter = getUserStateAdapter(namespace.adapter);
  return adapter.get(ctx, ctx.userId, namespace);
}

export async function setUserState(
  ctx: UserStateServiceContext,
  namespaceName: string,
  patch: Record<string, unknown>,
  opts: { source: SystemEventSource },
): Promise<UserStateDoc> {
  const namespace = await getUserStateNamespace(
    ctx.octokit,
    ctx.owner,
    ctx.repo,
    namespaceName,
  );
  if (!namespace) {
    throw new UserStateError(
      "namespace_not_found",
      `Unknown user-state namespace "${namespaceName}"`,
    );
  }
  const adapter = getUserStateAdapter(namespace.adapter);

  // CAS loop: on a write conflict, re-read, re-merge against the fresh
  // document, and retry — never rewrite a stale merge over concurrent data.
  // The write carries the revision of the SAME read the merge came from, so
  // a concurrent writer surfaces as a conflict instead of a lost update.
  const MAX_MERGE_ATTEMPTS = 5;
  let doc: UserStateDoc | null = null;
  for (let attempt = 1; attempt <= MAX_MERGE_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      // Backoff before re-merging: concurrent writers (bursts of events)
      // and GitHub read-after-write lag both need a beat to settle.
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    const existing = await adapter.get(ctx, ctx.userId, namespace);
    const merged =
      namespace.merge === "shallow-merge"
        ? { ...(existing?.data ?? {}), ...patch }
        : patch;

    const parsed = namespace.schema.safeParse(merged);
    if (!parsed.success) {
      throw new UserStateError(
        "validation_failed",
        `Data does not match the "${namespace.name}" schema`,
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      );
    }

    const candidate: UserStateDoc = {
      version: namespace.version,
      namespace: namespace.name,
      userId: ctx.userId,
      updatedAt: new Date().toISOString(),
      data: parsed.data,
    };
    try {
      await adapter.set(ctx, ctx.userId, namespace, candidate, {
        // undefined revision (adapter without CAS support) → best-effort.
        expectedRevision: existing ? existing.revision : null,
      });
      doc = candidate;
      break;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : "";
      const conflict =
        status === 409 ||
        status === 422 ||
        message.includes("changed since it was read");
      if (!conflict || attempt === MAX_MERGE_ATTEMPTS) throw error;
    }
  }
  if (!doc) {
    throw new UserStateError(
      "validation_failed",
      `Failed to write "${namespace.name}" state`,
    );
  }

  emitSystemEvent(
    "state.entity.written",
    {
      namespace: namespace.name,
      namespaceVersion: namespace.version,
      keys: Object.keys(patch).slice(0, 100),
      source: opts.source,
    },
    {
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      brand: { owner: ctx.owner, repo: ctx.repo },
      source: opts.source,
      octokit: ctx.octokit,
    },
  );

  return doc;
}
