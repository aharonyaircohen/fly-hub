/**
 * @fileType component
 * @domain kody
 *
 * AuthGuard — historically redirected to `/login` when no PAT was saved.
 * With the login route removed, gating now lives inside `KodyDashboard`
 * itself: it preserves the chrome and renders either the caller-owned
 * first-run fallback or `<RepoManager />` when no credentials exist. This
 * component keeps the loading flash during auth hydration centralised.
 */
"use client";

import { useAuth } from "./auth-context";
import { RepoManager } from "./components/RepoManager";
import { Loader2 } from "lucide-react";

export function AuthGuard({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { auth, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auth) return fallback ?? <RepoManager />;

  return <>{children}</>;
}
