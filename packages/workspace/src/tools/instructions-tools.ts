/**
 * @fileType util
 * @domain instructions
 * @pattern chat-tools
 * @ai-summary Chat tools to manage the single repo instructions file
 *   (`instructions.md` in Convex) — read, set, delete. The instructions body is
 *   appended to the chat system prompt, so it's how the user gives Kody
 *   standing guidance for this repo.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readInstructionsFile,
  writeInstructionsFile,
  deleteInstructionsFile,
} from "../instructions/files";
import { dashboardInstructionsUrl } from "@kody-ade/base/thread-link";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createInstructionsTools(ctx: Ctx) {
  const { owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_instructions: tool({
      description: `Read the standing instructions for ${repoRef} (Convex instructions.md), the markdown appended to Kody's system prompt for this repo. Returns null body if none set.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const file = await readInstructionsFile();
          return {
            body: file?.body ?? null,
            htmlUrl: file ? dashboardInstructionsUrl() : null,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_instructions: tool({
      description: `Replace the standing instructions for ${repoRef} in Convex. This OVERWRITES the whole document — read it first and include any content you want to keep. Body is plain markdown.`,
      inputSchema: z.object({ body: z.string().min(1) }),
      execute: async ({ body }) => {
        try {
          const existing = await readInstructionsFile();
          await writeInstructionsFile({ body });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            htmlUrl: dashboardInstructionsUrl(),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_instructions: tool({
      description: `Delete the standing instructions file for ${repoRef} (removes instructions.md from the Convex).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const existing = await readInstructionsFile();
          if (!existing) return { error: "no instructions file to delete" };
          await deleteInstructionsFile();
          return { ok: true, action: "deleted" };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
