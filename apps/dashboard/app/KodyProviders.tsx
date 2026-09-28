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
import { ServiceWorkerRegister } from "@dashboard/lib/push/ServiceWorkerRegister";
import { InboxWatcher } from "@dashboard/lib/inbox/useInboxWatcher";
import { PageViewTracker } from "@dashboard/lib/events/PageViewTracker";
import { ConvexClientProvider } from "@dashboard/lib/convex/ConvexClientProvider";
import { WebhookRegistrationReconciler } from "@dashboard/lib/webhooks/WebhookRegistrationReconciler";
import { InternalLinkNavigation } from "@dashboard/lib/components/InternalLinkNavigation";

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
          <AuthProvider persistence="account">
            <WebhookRegistrationReconciler />
            <InternalLinkNavigation />
            <ServiceWorkerRegister />
            <InboxWatcher />
            <PageViewTracker />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </ConvexClientProvider>
    </QueryClientProvider>
  );
}
