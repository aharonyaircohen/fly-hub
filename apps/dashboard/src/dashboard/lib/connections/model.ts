import { z } from "zod";

const connectionStatusSchema = z.enum([
  "connected",
  "needs_attention",
  "disabled",
]);

export const ConnectionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    provider: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    accountType: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    externalId: z.string().trim().min(1).max(128),
    credentialRefs: z
      .object({
        accessToken: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
      })
      .strict(),
    status: connectionStatusSchema,
    verifiedAt: z.string().datetime().nullable(),
  })
  .strict();

export type Connection = z.infer<typeof ConnectionSchema>;

export const SaveConnectionSchema = ConnectionSchema.pick({
  id: true,
  name: true,
  provider: true,
  accountType: true,
  externalId: true,
  credentialRefs: true,
}).strict();

export function connectionAfterSave(
  current: Connection | null,
  input: Pick<Connection, "name" | "externalId" | "credentialRefs"> &
    Partial<Pick<Connection, "id" | "provider" | "accountType">>,
): Connection {
  const identityChanged =
    !current ||
    current.externalId !== input.externalId ||
    current.credentialRefs.accessToken !== input.credentialRefs.accessToken;
  return ConnectionSchema.parse({
    id: input.id ?? current?.id ?? "facebook-main",
    name: input.name,
    provider: input.provider ?? current?.provider ?? "facebook",
    accountType: input.accountType ?? current?.accountType ?? "page",
    externalId: input.externalId,
    credentialRefs: input.credentialRefs,
    status: identityChanged ? "needs_attention" : current?.status ?? "needs_attention",
    verifiedAt: identityChanged ? null : current?.verifiedAt ?? null,
  });
}

export function connectionAfterVerification(
  current: Connection,
  result: { ok: true; verifiedAt: string } | { ok: false },
): Connection {
  return ConnectionSchema.parse({
    ...current,
    status: result.ok ? "connected" : "needs_attention",
    verifiedAt: result.ok ? result.verifiedAt : current.verifiedAt,
  });
}
