/**
 * @fileType component
 * @domain kody
 * @pattern client-provider
 * @ai-summary Client-side providers wrapper for Kody dashboard (QueryClientProvider + ThemeProvider)
 */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { ThemeProvider } from "@dashboard/providers/Theme";
import { AuthProvider } from "@dashboard/lib/auth-context";
import { ConvexClientProvider } from "@dashboard/lib/convex/ConvexClientProvider";
import { InternalLinkNavigation } from "@dashboard/lib/components/InternalLinkNavigation";
import { kodyAuthClient } from "@dashboard/lib/auth/kody-auth-client";
import { WebhookRegistrationReconciler } from "@dashboard/lib/webhooks/WebhookRegistrationReconciler";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false, // Disable to prevent refresh loops on tab-back when session expires
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    return makeQueryClient();
  } else {
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export function KodyProviders({
  children,
  initialAuthToken,
}: {
  children: React.ReactNode;
  initialAuthToken?: string | null;
}) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <ConvexClientProvider initialToken={initialAuthToken}>
        <ThemeProvider>
          <FlyAccountProviders>{children}</FlyAccountProviders>
        </ThemeProvider>
      </ConvexClientProvider>
    </QueryClientProvider>
  );
}

function FlyAccountProviders({ children }: { children: React.ReactNode }) {
  const { data: session } = kodyAuthClient.useSession();
  if (!session) return <>{children}</>;
  return (
    <AuthProvider persistence="account">
      <WebhookRegistrationReconciler />
      <InternalLinkNavigation />
      {children}
    </AuthProvider>
  );
}
