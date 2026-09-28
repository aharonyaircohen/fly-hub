/**
 * @fileType util
 * @domain vault
 * @pattern chat-tools
 * @ai-summary Chat tools for the encrypted secrets vault
 *   (`secrets.enc` in the backend). Deliberately WRITE-ONLY from chat: list shows
 *   names + timestamps only (never values), and set upserts a value — there
 *   is NO read-back tool, so a prompt-injected message can't exfiltrate keys.
 *   Mirrors the /api/kody/secrets route's readVault → mutate → writeVault.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { readVault, listSecretMetadata } from "@kody-ade/base/vault/store";
import {
  SecretUpsertSchema,
  upsertSecret,
} from "@kody-ade/base/vault/mutations";
import { isVaultConfigured } from "@kody-ade/base/vault/crypto";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
  onSecretWritten?: (name: string) => void;
}

export function createSecretTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin, onSecretWritten } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_secret_names: tool({
      description: `List the NAMES of secrets in ${repoRef}'s encrypted vault (with last-updated timestamps). Values are never returned — there is no way to read a secret value back through chat.`,
      inputSchema: z.object({}),
      execute: async () => {
        if (!isVaultConfigured())
          return {
            error: "vault_not_configured",
            message: "KODY_MASTER_KEY is not set on the server.",
          };
        try {
          const { doc } = await readVault(octokit, owner, repo);
          return { secrets: listSecretMetadata(doc) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_secret: tool({
      description: `Create or overwrite a secret value in ${repoRef}'s encrypted backend vault (AES-256-GCM, committed to secrets.enc). Use for API keys, tokens, etc. Names are UPPER_SNAKE_CASE. The value is write-only — it cannot be read back through chat. Confirm the value with the user before calling.`,
      inputSchema: SecretUpsertSchema,
      execute: async ({ name, value }) => {
        if (!isVaultConfigured())
          return {
            error: "vault_not_configured",
            message: "KODY_MASTER_KEY is not set on the server.",
          };
        try {
          const result = await upsertSecret({
            octokit,
            owner,
            repo,
            name,
            value,
            actorLogin,
          });
          onSecretWritten?.(name);
          return { ok: true, name, secrets: result.secrets };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
