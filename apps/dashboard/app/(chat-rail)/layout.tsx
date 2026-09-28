/**
 * @fileType layout
 * @domain layout
 * @pattern auth-route-group
 * @ai-summary Route-group layer that enforces AuthGuard for every page
 *   in this group. The persistent KodyChat used to live here, but it
 *   now lives in the root layout (ChatRailShell) so every authenticated
 *   page shares one chat instance — including the dashboard root and
 *   legacy redirects that sit outside this group. Kept as an auth boundary so
 *   pages don't each re-wrap themselves.
 */
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@dashboard/lib/auth-guard";

export default function ChatRailGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname.startsWith("/fly/")) return <>{children}</>;
  return <AuthGuard>{children}</AuthGuard>;
}
