/**
 * @fileType util
 * @domain models
 * @pattern chat-tools
 * @ai-summary Chat tools for the chat-model registry (the `LLM_MODELS`
 *   variable in the backend `variables.json`). Lists models and flips the
 *   chat/engine default + enabled flags. Adding brand-new provider bindings
 *   (with API-key secret wiring) stays in the /models page UI; chat only
 *   selects among existing entries. Mirrors the /api/kody/models PUT writer.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { readVariables } from "@kody-ade/base/variables/store";
import {
  readManagedChatModels,
  setManagedDefaultModel,
  setManagedModelEnabled,
} from "@kody-ade/base/variables/mutations";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createModelTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_models: tool({
      description: `List the configured chat models for ${repoRef} (id, label, provider, and whether each is enabled / the chat default / the engine default).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { doc } = await readVariables(owner, repo);
          const models = readManagedChatModels(doc).map((m) => ({
            id: m.id,
            label: m.label,
            provider: m.provider,
            enabled: m.enabled !== false,
            default: !!m.default,
            engineDefault: !!m.engineDefault,
          }));
          return { models };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_default_model: tool({
      description: `Set which model is the default in ${repoRef}. \`scope\` "chat" sets the chat-UI default, "engine" sets the engine/kody.yml default, "both" sets both. Clears the same flag on every other model so there's exactly one.`,
      inputSchema: z.object({
        id: z.string().min(1),
        scope: z.enum(["chat", "engine", "both"]).default("chat"),
      }),
      execute: async ({ id, scope }) => {
        try {
          const result = await setManagedDefaultModel({
            octokit,
            owner,
            repo,
            id,
            scope,
            actorLogin,
          });
          if (!result.found) return { error: `model "${id}" not found` };
          return {
            ok: true,
            id,
            scope,
            ...(result.engineSyncWarning
              ? { engineSyncWarning: result.engineSyncWarning }
              : {}),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_model_enabled: tool({
      description: `Enable or disable a model in ${repoRef} (a disabled model is hidden from the chat picker and can't be selected).`,
      inputSchema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      execute: async ({ id, enabled }) => {
        try {
          const result = await setManagedModelEnabled({
            octokit,
            owner,
            repo,
            id,
            enabled,
            actorLogin,
          });
          if (!result.found) return { error: `model "${id}" not found` };
          return {
            ok: true,
            id,
            enabled,
            ...(result.engineSyncWarning
              ? { engineSyncWarning: result.engineSyncWarning }
              : {}),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
