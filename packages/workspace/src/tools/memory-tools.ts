import { dashboardMemoryUrl } from "@kody-ade/base/thread-link";
import { logger } from "@kody-ade/base/logger";
import {
  MemoryNotFoundError,
  type EvidenceRef,
  type MemoryKind,
} from "@kody-ade/memory";
import { tool } from "ai";
import { z } from "zod";
import { createMemoryRuntime } from "../memory/runtime";
import { findDuplicateMemory } from "./memory-duplicates";

interface MemoryToolContext {
  readonly actorId: string;
  readonly tenantId?: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly includeRepositoryScope?: boolean;
  readonly conversationId?: string;
  readonly messageId?: string;
}

const memoryKind = z.enum([
  "preference",
  "fact",
  "decision",
  "reference",
]);
const memoryScope = z.enum(["user", "repository"]);
const contentFields = {
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(500),
  body: z.string().trim().min(10).max(20_000),
};

function evidence(context: MemoryToolContext): Readonly<EvidenceRef> {
  if (context.messageId) {
    return {
      source: "message",
      id: context.messageId,
      ...(context.conversationId
        ? { conversationId: context.conversationId }
        : {}),
    };
  }
  return {
    source: "conversation",
    id: context.conversationId ?? `chat-${crypto.randomUUID()}`,
  };
}

export function createMemoryTools(context: MemoryToolContext) {
  const tenantId =
    context.tenantId ??
    (context.owner && context.repo
      ? `${context.owner}/${context.repo}`
      : null);
  if (!tenantId) throw new Error("Memory tools require a tenant");
  let currentRuntime: ReturnType<typeof createMemoryRuntime> | null = null;
  const runtime = () => {
    currentRuntime ??= createMemoryRuntime({
      actor: { kind: "user", id: context.actorId },
      tenantId,
      includeRepositoryScope: context.includeRepositoryScope,
    });
    return currentRuntime;
  };
  const source = evidence(context);

  return {
    remember: tool({
      description:
        "Save one durable, non-obvious memory after checking for duplicates. Personal scope is only for information about the user across repositories. Repository scope is for user-provided project context. Do not proactively save repository facts readable from files, but honor an explicit request in repository scope.",
      inputSchema: z.object({
        scope: memoryScope,
        kind: memoryKind,
        ...contentFields,
        reason: z.string().trim().min(10).max(500),
      }),
      execute: async (input) => {
        try {
          const scope =
            input.scope === "user" || context.includeRepositoryScope === false
              ? {
                  kind: "user" as const,
                  userId: runtime().principal.actor.id,
                }
              : { kind: "repository" as const, tenantId };
          const content = {
            title: input.title,
            summary: input.summary,
            body: input.body,
          };
          const candidates = await runtime().application.search({
            principal: runtime().principal,
            scopes: [scope],
            query: input.summary,
            limit: 10,
          });
          const duplicate = findDuplicateMemory(candidates, {
            kind: input.kind,
            content,
          });
          if (duplicate) {
            return {
              memory: duplicate,
              url: dashboardMemoryUrl(duplicate.id),
              duplicate: true,
            };
          }
          const memory = await runtime().application.remember({
            principal: runtime().principal,
            scope,
            kind: input.kind,
            content,
            evidence: [source],
            reason: input.reason,
          });
          return {
            memory,
            url: dashboardMemoryUrl(memory.id),
          };
        } catch (error) {
          logger.warn({ error, tenantId }, "remember failed");
          return { error: "memory_write_failed" };
        }
      },
    }),

    recall: tool({
      description: "Read one memory by id.",
      inputSchema: z.object({ id: z.string().min(1).max(128) }),
      execute: async ({ id }) => {
        try {
          return {
            found: true,
            memory: await runtime().application.get({
              principal: runtime().principal,
              memoryId: id,
            }),
          };
        } catch (error) {
          if (error instanceof MemoryNotFoundError) {
            return { found: false, id };
          }
          throw error;
        }
      },
    }),

    update_memory: tool({
      description:
        "Correct or refine an existing memory while preserving its revision history.",
      inputSchema: z.object({
        id: z.string().min(1).max(128),
        kind: memoryKind.optional(),
        title: contentFields.title.optional(),
        summary: contentFields.summary.optional(),
        body: contentFields.body.optional(),
        reason: z.string().trim().min(10).max(500),
      }),
      execute: async (input) => {
        const current = await runtime().application.get({
          principal: runtime().principal,
          memoryId: input.id,
        });
        const memory = await runtime().application.correct({
          principal: runtime().principal,
          memoryId: current.id,
          kind: (input.kind ?? current.kind) as MemoryKind,
          content: {
            title: input.title ?? current.content.title,
            summary: input.summary ?? current.content.summary,
            body: input.body ?? current.content.body,
          },
          evidence: [source],
          reason: input.reason,
        });
        return { memory, url: dashboardMemoryUrl(memory.id) };
      },
    }),

    forget: tool({
      description:
        "Delete a memory only when the user explicitly asks to forget it.",
      inputSchema: z.object({ id: z.string().min(1).max(128) }),
      execute: async ({ id }) => {
        try {
          await runtime().application.forget({
            principal: runtime().principal,
            memoryId: id,
          });
          return { found: true, id, deleted: true };
        } catch (error) {
          if (error instanceof MemoryNotFoundError) {
            return { found: false, id };
          }
          throw error;
        }
      },
    }),

    list_memories: tool({
      description:
        "List current personal and repository memories when the user asks what Kody remembers.",
      inputSchema: z.object({ kind: memoryKind.optional() }),
      execute: async ({ kind }) => {
        const memories = await runtime().application.list({
          principal: runtime().principal,
          scopes: runtime().scopes,
        });
        const filtered = kind
          ? memories.filter((memory) => memory.kind === kind)
          : memories;
        return { count: filtered.length, memories: filtered };
      },
    }),

    recall_search: tool({
      description:
        "Search relevant personal and repository memory by text before answering a memory-dependent question.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500),
      }),
      execute: async ({ query }) => {
        const memories = await runtime().application.search({
          principal: runtime().principal,
          scopes: runtime().scopes,
          query,
          limit: 20,
        });
        return { count: memories.length, memories };
      },
    }),
  };
}
