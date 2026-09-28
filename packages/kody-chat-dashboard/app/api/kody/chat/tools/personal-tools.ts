import { tool } from "ai";
import { z } from "zod";
import { encrypt, isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { isInternalKodyCredential } from "@kody-ade/base/auth/internal-credentials";

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);

export function createPersonalChatTools(userId: string) {
  const tenantId = `user:${userId}`;
  const backend = () => createBackendClient();
  const commandKind = (value: string) => `command:${value}`;
  return {
    list_commands: tool({
      description: "List the user's personal slash commands.",
      inputSchema: z.object({}),
      execute: async () => ({
        commands: await backend().query(api.repoDocs.listByPrefix, {
          tenantId,
          prefix: "command:",
        }),
      }),
    }),
    read_command: tool({
      description: "Read one personal slash command.",
      inputSchema: z.object({ slug }),
      execute: async ({ slug: value }) => ({
        command: await backend().query(api.repoDocs.get, {
          tenantId,
          kind: commandKind(value),
        }),
      }),
    }),
    create_or_update_command: tool({
      description: "Create or update one personal slash command.",
      inputSchema: z.object({
        slug,
        description: z.string().max(300).default(""),
        argumentHint: z.string().max(120).optional(),
        body: z.string().min(1).max(20_000),
      }),
      execute: async (input) => {
        await backend().mutation(api.repoDocs.save, {
          tenantId,
          kind: commandKind(input.slug),
          doc: {
            description: input.description,
            argumentHint: input.argumentHint ?? "",
            body: input.body,
          },
          updatedAt: new Date().toISOString(),
        });
        return { ok: true, slug: input.slug };
      },
    }),
    delete_command: tool({
      description: "Delete one personal slash command.",
      inputSchema: z.object({ slug }),
      execute: async ({ slug: value }) => {
        await backend().mutation(api.repoDocs.remove, {
          tenantId,
          kind: commandKind(value),
        });
        return { ok: true, slug: value };
      },
    }),
    read_instructions: tool({
      description: "Read the user's personal instructions for Kody.",
      inputSchema: z.object({}),
      execute: async () => ({
        instructions: await backend().query(api.repoDocs.get, {
          tenantId,
          kind: "instructions",
        }),
      }),
    }),
    set_instructions: tool({
      description: "Set the user's personal instructions for Kody.",
      inputSchema: z.object({ body: z.string().min(1).max(20_000) }),
      execute: async ({ body }) => {
        await backend().mutation(api.repoDocs.save, {
          tenantId,
          kind: "instructions",
          doc: { body },
          updatedAt: new Date().toISOString(),
        });
        return { ok: true };
      },
    }),
    delete_instructions: tool({
      description: "Delete the user's personal instructions.",
      inputSchema: z.object({}),
      execute: async () => {
        await backend().mutation(api.repoDocs.remove, {
          tenantId,
          kind: "instructions",
        });
        return { ok: true };
      },
    }),
    list_secret_names: tool({
      description:
        "List personal secret names and metadata. Never returns values.",
      inputSchema: z.object({}),
      execute: async () => ({
        secrets: (
          await backend().query(api.userCredentials.list, { userKey: userId })
        ).filter((secret) => !isInternalKodyCredential(secret.name)),
      }),
    }),
    set_secret: tool({
      description: "Securely save a personal secret. Never echo its value.",
      inputSchema: z.object({
        name: secretName,
        value: z
          .string()
          .min(1)
          .max(64 * 1024),
      }),
      execute: async ({ name, value }) => {
        if (!isVaultConfigured()) return { error: "vault_not_configured" };
        await backend().mutation(api.userCredentials.upsert, {
          userKey: userId,
          name,
          encryptedValue: encrypt(value),
          updatedAt: new Date().toISOString(),
        });
        return { ok: true, name };
      },
    }),
  };
}
