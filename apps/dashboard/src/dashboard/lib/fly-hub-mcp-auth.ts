import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@kody-ade/base/vault/crypto";
import { z } from "zod";

const grantSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  token: z.string().min(1),
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  scopes: z.array(z.enum(["read", "manage", "command"])).min(1),
  expiresAt: z.number().int(),
});

export type FlyHubMcpGrant = z.infer<typeof grantSchema>;

export function issueFlyHubMcpGrant(input: {
  token: string;
  orgSlug: string;
  scopes: FlyHubMcpGrant["scopes"];
}) {
  const grant = grantSchema.parse({
    version: 1,
    id: randomUUID(),
    ...input,
    expiresAt: Date.now() + 15 * 60_000,
  });
  return { bearerToken: `fhmcp_${encrypt(JSON.stringify(grant))}`, expiresAt: grant.expiresAt };
}

export function readFlyHubMcpGrant(authorization: string | null): FlyHubMcpGrant | null {
  if (!authorization?.startsWith("Bearer fhmcp_")) return null;
  try {
    const grant = grantSchema.parse(JSON.parse(decrypt(authorization.slice("Bearer fhmcp_".length))));
    return grant.expiresAt > Date.now() ? grant : null;
  } catch {
    return null;
  }
}
