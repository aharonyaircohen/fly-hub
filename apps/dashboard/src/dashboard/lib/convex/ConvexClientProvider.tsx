/**
 * @fileType component
 * @domain kody
 * @pattern client-provider
 * @ai-summary Optional Convex live-subscription provider. Mounts a
 *   ConvexReactClient (from NEXT_PUBLIC_CONVEX_URL) around the app so
 *   `useConvexLive` hooks get reactive queries. When the env var is unset
 *   the provider renders children untouched and every live hook falls back
 *   to interval polling — the dashboard works identically without Convex.
 */
"use client";

import React from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { kodyAuthClient } from "@dashboard/lib/auth/kody-auth-client";

/** Build-time constant — identical for every render of this deployment. */
export const CONVEX_LIVE_ENABLED = !!process.env.NEXT_PUBLIC_CONVEX_URL;

let client: ConvexReactClient | null = null;

function getConvexReactClient(): ConvexReactClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  if (!client) client = new ConvexReactClient(url);
  return client;
}

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  const convex = getConvexReactClient();
  if (!convex) return <>{children}</>;
  return (
    <ConvexBetterAuthProvider
      client={convex}
      authClient={kodyAuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
