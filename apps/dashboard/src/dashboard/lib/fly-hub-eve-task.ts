import { randomBytes, randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@kody-ade/base/vault/crypto";
import { z } from "zod";

const taskSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  token: z.string().min(1),
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  passwordSeed: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int(),
});

export type FlyHubEveTask = z.infer<typeof taskSchema>;

export function issueFlyHubEveTask(input: {
  token: string;
  orgSlug: string;
  repository: string;
  commitSha: string;
}) {
  const task = taskSchema.parse({
    version: 1,
    id: randomUUID(),
    ...input,
    passwordSeed: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
  return `fheve_${encrypt(JSON.stringify(task))}`;
}

export function readFlyHubEveTask(value: string): FlyHubEveTask | null {
  if (!value.startsWith("fheve_") || value.length > 4_096) return null;
  try {
    const task = taskSchema.parse(JSON.parse(decrypt(value.slice(6))));
    return task.expiresAt > Date.now() ? task : null;
  } catch {
    return null;
  }
}
