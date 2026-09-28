/**
 * @fileType utility
 * @domain user-state
 * @pattern chat-tools
 * @ai-summary Two generic, business-agnostic progress tools: read and write a
 *   numeric position for a model-supplied key, per student. Kody never knows
 *   what the key or the number mean — a brand's system prompt decides that
 *   (e.g. "after each lesson step, call set_position('lesson:fractions', n)").
 *   The value lives in the student's user-state `progress` namespace, so it
 *   persists and resumes across sessions and routes to the brand's own
 *   backend via the user-state adapter.
 */
import { tool, type ToolSet } from "ai";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import {
  getUserState,
  setUserState,
  type UserStateServiceContext,
} from "../../../../../src/dashboard/lib/user-state";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Unified actor id of the chatting student. */
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

/** Namespaced so position keys never collide with other progress keys. */
function positionKey(key: string): string {
  return `position:${key}`;
}

const keyInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    "An opaque key you choose to identify this sequence for the current " +
      "user, e.g. 'lesson:fractions'. Reuse the same key to resume.",
  );

export function createPositionTools(ctx: Ctx): ToolSet {
  return {
    get_position: tool({
      description:
        "Read the current user's saved position (a number) for a key. " +
        "Returns 0 if none is saved yet. Use it to resume where the user " +
        "left off.",
      inputSchema: z.object({ key: keyInput }).strict(),
      execute: async ({ key }) => {
        const doc = await getUserState(serviceContext(ctx), "progress");
        const value = doc?.data[positionKey(key)];
        return { key, position: typeof value === "number" ? value : 0 };
      },
    }),

    set_position: tool({
      description:
        "Save the current user's position (a number) for a key. Call this " +
        "when the user completes a step so their progress persists and " +
        "resumes next session.",
      // Coerce the number — models sometimes pass it as a string ("3").
      inputSchema: z
        .object({ key: keyInput, position: z.coerce.number().int().min(0) })
        .strict(),
      execute: async ({ key, position }) => {
        await setUserState(
          serviceContext(ctx),
          "progress",
          { [positionKey(key)]: position },
          { source: "system" },
        );
        return { saved: true, key, position };
      },
    }),
  };
}
