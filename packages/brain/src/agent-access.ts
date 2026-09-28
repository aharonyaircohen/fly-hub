import { createHash, randomUUID } from "node:crypto";
import { encrypt, decrypt } from "@kody-ade/base/vault/crypto";
import { z } from "zod";
import { getPersonalBrainServices } from "./personal-services";

const identitySchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1),
  app: z.string().min(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
const PREFIX = "kody_brain_";
export const agentTokenId = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** The connection holds an identity, never a copy of the owner's credentials. */
export async function prepareAgentAccess(
  userId: string,
  app: string,
  origin: string,
) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Agent access requires a secure dashboard URL");
  const services = getPersonalBrainServices();
  const saved = (await services.loadState(userId, "agent-access")) as {
    token?: string;
    app?: string;
    updatedAt?: string;
  } | null;
  let token = saved?.app === app ? saved.token : undefined;
  if (!token) {
    token =
      PREFIX +
      encrypt(
        JSON.stringify({
          version: 1,
          userId,
          app,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        }),
      );
    try {
      await services.saveState(
        userId,
        "agent-access",
        { app, token, updatedAt: new Date().toISOString() },
        saved?.updatedAt ?? null,
      );
    } catch (error) {
      // A concurrent provision can create the same connection first.
      const current = (await services.loadState(userId, "agent-access")) as {
        app?: string;
        token?: string;
      } | null;
      if (current?.app !== app || !current.token) throw error;
      token = current.token;
    }
  }
  return { url: url.origin + "/api/kody/brain/agent", token };
}

export async function authenticateAgentAccess(token: string) {
  if (!token.startsWith(PREFIX) || token.length > 4096) return null;
  try {
    const identity = identitySchema.parse(
      JSON.parse(decrypt(token.slice(PREFIX.length))),
    );
    const services = getPersonalBrainServices();
    const saved = (await services.loadState(
      identity.userId,
      "agent-access",
    )) as { token?: string; app?: string } | null;
    if (
      !saved?.token ||
      agentTokenId(saved.token) !== agentTokenId(token) ||
      saved.app !== identity.app
    )
      return null;
    const app = (await services.loadState(identity.userId, "app")) as {
      appName?: string;
    } | null;
    if (app?.appName !== identity.app) return null;
    return identity;
  } catch {
    return null;
  }
}

export async function revokeAgentAccess(userId: string) {
  await getPersonalBrainServices().saveState(userId, "agent-access", null);
}
