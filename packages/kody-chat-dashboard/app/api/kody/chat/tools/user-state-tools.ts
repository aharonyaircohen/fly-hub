/**
 * @fileType utility
 * @domain user-state
 * @pattern chat-tools
 * @ai-summary Chat tools over the user-state contract: list namespaces, read
 *   the acting user's document, and (for model-writable namespaces only)
 *   propose a save. Every model write emits `model.save.proposed` before the
 *   schema-validated write, so the event stream records model-initiated
 *   saves distinctly.
 */
import { tool, type ToolSet } from "ai";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import { emitSystemEvent } from "@kody-ade/base/events";
import {
  getUserState,
  getUserStateNamespaces,
  setUserState,
  UserStateError,
  type UserStateServiceContext,
} from "../../../../../src/dashboard/lib/user-state";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Unified actor id of the chatting user. */
  userId: string;
  sessionId?: string | null;
}

function serviceContext(ctx: Ctx): UserStateServiceContext {
  return {
    octokit: ctx.octokit,
    owner: ctx.owner,
    repo: ctx.repo,
    userId: ctx.userId,
    sessionId: ctx.sessionId ?? null,
  };
}

function toolError(error: unknown): { error: string; issues?: string[] } {
  if (error instanceof UserStateError) {
    return { error: error.message, issues: error.issues };
  }
  throw error;
}

export async function createUserStateTools(ctx: Ctx): Promise<ToolSet> {
  const namespaces = await getUserStateNamespaces(
    ctx.octokit,
    ctx.owner,
    ctx.repo,
  );
  const readableNames = namespaces.map((ns) => ns.name);
  const writableNames = namespaces
    .filter((ns) => ns.modelWritable)
    .map((ns) => ns.name);
  if (readableNames.length === 0) return {};

  const tools: ToolSet = {
    user_state_list_namespaces: tool({
      description:
        "List the user-state namespaces available for the current user " +
        "(name, version, whether you may write them).",
      inputSchema: z.object({}).strict(),
      execute: async () => ({
        namespaces: namespaces.map((ns) => ({
          name: ns.name,
          version: ns.version,
          origin: ns.origin,
          modelWritable: ns.modelWritable,
        })),
      }),
    }),
    user_state_get: tool({
      description:
        "Read the current user's stored data for a user-state namespace.",
      inputSchema: z
        .object({
          namespace: z.enum(readableNames as [string, ...string[]]),
        })
        .strict(),
      execute: async ({ namespace }) => {
        try {
          const doc = await getUserState(serviceContext(ctx), namespace);
          return { doc };
        } catch (error) {
          return toolError(error);
        }
      },
    }),
  };

  if (writableNames.length > 0) {
    tools.user_state_set = tool({
      description:
        "Save data to a user-state namespace for the current user. Only " +
        "use when the user has clearly stated the information; the data " +
        "must match the namespace schema or the save is rejected.",
      inputSchema: z
        .object({
          namespace: z.enum(writableNames as [string, ...string[]]),
          data: z.record(z.string(), z.unknown()),
        })
        .strict(),
      execute: async ({ namespace, data }) => {
        emitSystemEvent(
          "model.save.proposed",
          {
            namespace,
            keys: Object.keys(data).slice(0, 100),
            ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          },
          {
            userId: ctx.userId,
            sessionId: ctx.sessionId ?? null,
            brand: { owner: ctx.owner, repo: ctx.repo },
            source: "model",
            octokit: ctx.octokit,
          },
        );
        try {
          const doc = await setUserState(serviceContext(ctx), namespace, data, {
            source: "model",
          });
          return { saved: true, doc };
        } catch (error) {
          return toolError(error);
        }
      },
    });
  }

  return tools;
}
