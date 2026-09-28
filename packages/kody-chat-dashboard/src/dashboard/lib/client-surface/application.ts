/**
 * Brand Chat application boundary.
 *
 * Route parsing, tenant resolution, brand loading, and access decisions live
 * here. Next.js pages translate the result into UI only.
 */
import { getBuiltinClientBrand } from "../client-brand";
import {
  resolveClientBrand,
  type ClientBrand,
  type ClientBrandResolveContext,
} from "../client-brand";
import { defaultClientBrandRepoContext } from "../client-brand-default-repo";
import type { ClientBrandRepoContext } from "../client-brand-repo-cookie";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { resolveClientSurfaceAccess } from "../client-session/access";
import {
  verifyClientSession,
  type ClientIdentity,
} from "../client-session/session";

export interface ClientSurfaceRoute {
  brandSlug: string;
  urlContext: ClientBrandRepoContext | null;
  callbackUrl: string;
}

export interface ClientSurfaceDefinition {
  route: ClientSurfaceRoute;
  brand: ClientBrand;
  context: ClientBrandResolveContext | null;
}

export type AuthorizedClientSurface =
  | { kind: "public"; identity: null }
  | { kind: "authorized"; identity: ClientIdentity }
  | { kind: "unauthenticated"; identity: null }
  | { kind: "forbidden"; identity: null };

const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function parseClientSurfaceRoute(
  path: string[] | undefined,
): ClientSurfaceRoute | null {
  if (!Array.isArray(path)) return null;
  let segments: string[];
  try {
    segments = path.map((segment) => decodeURIComponent(segment).trim());
  } catch {
    return null;
  }
  if (segments.some((segment) => !segment)) return null;
  if (segments.length === 1 && getBuiltinClientBrand(segments[0])) {
    return {
      brandSlug: segments[0],
      urlContext: null,
      callbackUrl: `/client/${encodeURIComponent(segments[0])}`,
    };
  }
  if (segments.length !== 3) return null;
  const [owner, repo, brandSlug] = segments;
  if (!OWNER_REPO_PATTERN.test(owner) || !OWNER_REPO_PATTERN.test(repo)) {
    return null;
  }
  return {
    brandSlug,
    urlContext: { owner, repo },
    callbackUrl: `/client/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(brandSlug)}`,
  };
}

async function resolveContext(
  route: ClientSurfaceRoute,
): Promise<ClientBrandResolveContext | null> {
  const repoContext = route.urlContext ?? defaultClientBrandRepoContext();
  if (!repoContext) return null;
  const background = await resolveBackgroundToken(
    repoContext.owner,
    repoContext.repo,
  );
  return {
    ...repoContext,
    ...(background ? { token: background.token } : {}),
  };
}

export async function loadClientSurfaceDefinition(
  path: string[] | undefined,
): Promise<ClientSurfaceDefinition | null> {
  const route = parseClientSurfaceRoute(path);
  if (!route) return null;
  const context = await resolveContext(route);
  const brand = await resolveClientBrand(route.brandSlug, context);
  return brand ? { route, brand, context } : null;
}

export async function authorizeClientSurface(
  definition: ClientSurfaceDefinition,
  sessionToken: string | null | undefined,
): Promise<AuthorizedClientSurface> {
  const session = await verifyClientSession(sessionToken);
  const result = resolveClientSurfaceAccess({
    access: definition.brand.access,
    owner: definition.context?.owner ?? "",
    repo: definition.context?.repo ?? "",
    brandSlug: definition.brand.slug,
    session,
  });
  if (result.kind === "authorized") {
    return { kind: "authorized", identity: result.identity };
  }
  return { kind: result.kind, identity: null };
}
