/**
 * @fileType page
 * @domain client-chat
 * @pattern client-chat-route
 * @ai-summary Brand-scoped client chat route. It renders a standalone shell
 *   around the real KodyChat and stays outside the dashboard chat rail.
 *   URL shape: /client/<owner>/<repo>/<brandSlug> — self-contained; the link
 *   itself names the repo the brand lives in, so any visitor on any device
 *   resolves the right context (Kody backend stays repo-agnostic).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

// Package-owned (hosts deleted their copies) — must stay relative.
import { ClientChatSurface } from "../../../src/dashboard/lib/components/ClientChatSurface";
import {
  authorizeClientSurface,
  loadClientSurfaceDefinition,
} from "../../../src/dashboard/lib/client-surface/application";
import { getClientSurfaceCatalog } from "../../../src/dashboard/lib/client-chat-strings";
import { resolveClientLanguageStrings } from "../../../src/dashboard/lib/client-language-resolver";
import { mintClientSurfaceTicket } from "../../../src/dashboard/lib/chat/platform/surface-scope";
import { CLIENT_SESSION_COOKIE } from "../../../src/dashboard/lib/client-session/session";
import { ClientAccessGate } from "../../../src/dashboard/lib/client-session/ClientAccessGate";
import { PageViewTracker } from "../../../src/dashboard/lib/events/PageViewTracker";
import { createUserOctokit } from "@kody-ade/base/github/core";
import { BrandSnippets } from "../../../src/dashboard/lib/snippets/BrandSnippets";
import { getSnippets } from "../../../src/dashboard/lib/snippets/store";
import type { SnippetConfig } from "../../../src/dashboard/lib/snippets/types";
import { AuthProvider } from "../../../src/dashboard/lib/auth-context";

interface ClientChatPageProps {
  params: Promise<{ path: string[] }>;
}

export async function generateMetadata({
  params,
}: ClientChatPageProps): Promise<Metadata> {
  const { path } = await params;
  const definition = await loadClientSurfaceDefinition(path);
  if (!definition) notFound();
  const { brand, context } = definition;

  const languageStrings = await resolveClientLanguageStrings(
    brand.locale ?? "en",
    context,
  );
  const catalog = getClientSurfaceCatalog(
    brand.locale ?? "en",
    languageStrings,
  );

  return {
    title: catalog.t("chat.client.metaTitle", { brand: brand.name }),
    description: catalog.t("chat.client.metaDescription", {
      brand: brand.name,
    }),
  };
}

export default async function ClientChatPage({ params }: ClientChatPageProps) {
  const { path } = await params;
  const definition = await loadClientSurfaceDefinition(path);
  if (!definition) notFound();
  const { route, brand, context } = definition;

  const languageStrings = await resolveClientLanguageStrings(
    brand.locale ?? "en",
    context,
  );

  let surfaceUser:
    | { name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  const callbackUrl = route.callbackUrl;
  const cookieStore = await cookies();
  const access = await authorizeClientSurface(
    definition,
    cookieStore.get(CLIENT_SESSION_COOKIE)?.value,
  );
  if (access.kind === "unauthenticated" || access.kind === "forbidden") {
    return (
      <ClientAccessGate brand={brand} forbidden={access.kind === "forbidden"} />
    );
  }
  if (access.kind === "authorized") {
    surfaceUser = {
      name: access.identity.name,
      email: access.identity.email,
      image: access.identity.image,
    };
  }

  let ticket: string | undefined;
  if (context) {
    try {
      ticket = mintClientSurfaceTicket({
        brandSlug: brand.slug,
        owner: context.owner,
        repo: context.repo,
      }).ticket;
    } catch {
      ticket = undefined;
    }
  }

  // Brand snippets (analytics tags, widgets, ...) — server-rendered so
  // body-start snippets execute before the app hydrates. Best-effort: a
  // failed read never blocks the page.
  let snippets: readonly SnippetConfig[] = [];
  if (context?.token) {
    try {
      snippets = await getSnippets(
        createUserOctokit(context.token),
        context.owner,
        context.repo,
      );
    } catch {
      snippets = [];
    }
  }

  return (
    <>
      <BrandSnippets snippets={snippets} placement="body-start" />
      <PageViewTracker />
      <AuthProvider>
        <ClientChatSurface
          brand={brand}
          surfaceTicket={ticket}
          user={surfaceUser}
          languageStrings={languageStrings}
          signOutAction={
            surfaceUser
              ? async () => {
                  "use server";
                  const sessionCookies = await cookies();
                  sessionCookies.delete(CLIENT_SESSION_COOKIE);
                  redirect(callbackUrl);
                }
              : undefined
          }
        />
      </AuthProvider>
      <BrandSnippets snippets={snippets} placement="body-end" />
    </>
  );
}
