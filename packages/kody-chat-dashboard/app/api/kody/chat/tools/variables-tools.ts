/**
 * @fileType util
 * @domain variables
 * @pattern chat-tools
 * @ai-summary Chat tools to manage non-secret dashboard variables
 *   (`variables.json` in the backend) — list, set, delete. Variables are plaintext
 *   config knobs (unlike the encrypted secrets vault). The reserved
 *   LLM_MODELS variable is managed via the models tools, not here.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { readVariables, listVariables } from "@kody-ade/base/variables/store";
import {
  ConfigNameSchema,
  ConfigValueSchema,
  RESERVED_VARIABLE_NAMES,
  deleteVariable,
  upsertVariable,
} from "@kody-ade/base/variables/mutations";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createVariableTools(ctx: Ctx) {
  const { owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_variables: tool({
      description: `List the non-secret dashboard variables for ${repoRef} (variables.json in the backend) with their values and last-updated timestamps. These are plaintext config — secrets live in the encrypted vault instead.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { doc } = await readVariables(owner, repo);
          return { variables: listVariables(doc) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_variable: tool({
      description: `Set (create or overwrite) a non-secret variable in ${repoRef}. Use this only for non-sensitive config; anything secret (API keys, tokens) must go through set_secret instead.`,
      inputSchema: z.object({
        name: ConfigNameSchema,
        value: ConfigValueSchema,
      }),
      execute: async ({ name, value }) => {
        if (RESERVED_VARIABLE_NAMES.has(name))
          return {
            error: `"${name}" is reserved — manage it via the models tools.`,
          };
        try {
          await upsertVariable({ owner, repo, name, value, actorLogin });
          return { ok: true, name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_variable: tool({
      description: `Delete a non-secret variable from ${repoRef}.`,
      inputSchema: z.object({ name: ConfigNameSchema }),
      execute: async ({ name }) => {
        if (RESERVED_VARIABLE_NAMES.has(name))
          return {
            error: `"${name}" is reserved — manage it via the models tools.`,
          };
        try {
          const result = await deleteVariable({ owner, repo, name });
          if (!result.found) return { error: `variable "${name}" not found` };
          return { ok: true, action: "deleted", name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
