import { z } from "zod";

import { KODY_INTERNAL_CREDENTIAL_PREFIX } from "@kody-ade/base/auth/internal-credentials";

export const ACCOUNT_REPOSITORY_CREDENTIAL_NAME = `${KODY_INTERNAL_CREDENTIAL_PREFIX}REPOSITORY_CONNECTIONS`;

const GitHubUserSchema = z.object({
  login: z.string().min(1).max(100),
  avatar_url: z.string().max(2_048),
  id: z.number(),
});

const RepositorySchema = z.object({
  repoUrl: z.string().max(2_048),
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  token: z.string().min(1).max(16_384),
  addedAt: z.number(),
  isLogin: z.boolean(),
  user: GitHubUserSchema.optional(),
});

export const AccountRepositoryAuthSchema = z.object({
  repoUrl: z.string().max(2_048),
  owner: z.string().max(100),
  repo: z.string().max(100),
  token: z.string().max(16_384),
  user: GitHubUserSchema,
  loggedInAt: z.number(),
  repos: z.array(RepositorySchema).max(100),
  currentRepoIndex: z.number(),
  brain: z
    .object({ url: z.string().max(2_048), apiKey: z.string().max(16_384) })
    .optional(),
  vercelBypassSecret: z.string().max(16_384).optional(),
  flyPerf: z.enum(["low", "medium", "high"]).optional(),
  brainPerf: z.enum(["low", "medium", "high"]).optional(),
  brainSuspension: z.enum(["auto", "never"]).optional(),
  brainTerminalActivityLimit: z
    .union([z.number(), z.literal("never")])
    .optional(),
  storeRepoUrl: z.string().max(2_048).optional(),
  storeRef: z.string().max(300).optional(),
});

export function parseAccountRepositoryCredentials(value: unknown) {
  const parsed = AccountRepositoryAuthSchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.repos.map(({ owner, repo, token, user }) => ({
    owner,
    repo,
    token,
    actorGithubId: user?.id ?? parsed.data.user.id,
  }));
}
