import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import {
  invalidateVaultCache,
  listSecretMetadata,
  readVault,
  writeVault,
} from "./store";
import { ConfigNameSchema, ConfigValueSchema } from "../config-input";

export const SecretUpsertSchema = z.object({
  name: ConfigNameSchema,
  value: ConfigValueSchema,
});

export const SecretWriteSchema = SecretUpsertSchema.extend({
  actorLogin: z.string().optional(),
});

export async function upsertSecret(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  name: string;
  value: string;
  actorLogin?: string | null;
  now?: string;
}) {
  const parsed = SecretUpsertSchema.parse(input);
  const { doc, sha } = await readVault(input.octokit, input.owner, input.repo, {
    force: true,
  });
  const next = {
    ...doc,
    secrets: {
      ...doc.secrets,
      [parsed.name]: {
        value: parsed.value,
        updatedAt: input.now ?? new Date().toISOString(),
        ...(input.actorLogin ? { updatedBy: input.actorLogin } : {}),
      },
    },
  };
  await writeVault(
    input.octokit,
    input.owner,
    input.repo,
    next,
    sha,
    `chore(vault): upsert ${parsed.name}`,
  );
  invalidateVaultCache(input.owner, input.repo);
  return { secrets: listSecretMetadata(next) };
}

export async function deleteSecret(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  name: string;
}): Promise<{
  found: boolean;
  secrets: ReturnType<typeof listSecretMetadata>;
}> {
  const name = ConfigNameSchema.parse(input.name);
  const { doc, sha } = await readVault(input.octokit, input.owner, input.repo, {
    force: true,
  });
  if (!doc.secrets[name]) {
    return { found: false, secrets: listSecretMetadata(doc) };
  }
  const secrets = { ...doc.secrets };
  delete secrets[name];
  const next = { ...doc, secrets };
  await writeVault(
    input.octokit,
    input.owner,
    input.repo,
    next,
    sha,
    `chore(vault): delete ${name}`,
  );
  invalidateVaultCache(input.owner, input.repo);
  return { found: true, secrets: listSecretMetadata(next) };
}
