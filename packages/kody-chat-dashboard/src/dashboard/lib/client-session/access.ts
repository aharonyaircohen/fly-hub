import type { ClientBrandAccess } from "@kody-ade/base/client-brand";
import type { ClientIdentity, ClientSession } from "./session";

export type ClientSurfaceAccessResult =
  | { kind: "public" }
  | { kind: "authorized"; identity: ClientIdentity }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

export function resolveClientSurfaceAccess(input: {
  access: ClientBrandAccess;
  owner: string;
  repo: string;
  brandSlug: string;
  session: ClientSession | null;
}): ClientSurfaceAccessResult {
  if (input.access.mode === "public") return { kind: "public" };
  if (!input.session) return { kind: "unauthenticated" };
  if (
    input.session.owner !== input.owner ||
    input.session.repo !== input.repo ||
    input.session.brandSlug !== input.brandSlug
  ) {
    return { kind: "forbidden" };
  }
  return { kind: "authorized", identity: input.session.identity };
}
