"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SETTINGS_NAV_SECTIONS } from "@dashboard/lib/components/settings-nav";
import { kodyAuthClient } from "@dashboard/lib/auth/kody-auth-client";
import { useAuth } from "@dashboard/lib/auth-context";
import { RepoManager } from "@dashboard/lib/components/RepoManager";
import { RepoSwitcher } from "@kody-ade/kody-chat-dashboard/components/RepoSwitcher";

const flyItems = SETTINGS_NAV_SECTIONS
  .find((section) => section.title === "Fly")
  ?.items ?? [];

export function FlyShell({ children }: { children: ReactNode }) {
  const { data: session } = kodyAuthClient.useSession();
  if (session) return <AuthenticatedFlyShell>{children}</AuthenticatedFlyShell>;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background px-5 py-3 md:px-7">
        <Link href="/fly/config" className="text-lg font-semibold tracking-tight">Fly Hub</Link>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function AuthenticatedFlyShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { auth, loading } = useAuth();

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background px-5 py-3 md:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/fly/config" className="text-lg font-semibold tracking-tight">
            Fly Hub
          </Link>
          <div className="flex items-center gap-4">
            <RepoSwitcher />
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => void kodyAuthClient.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Fly pages" className="mt-3 flex gap-1 overflow-x-auto">
            {flyItems.map((item) => {
              const active = pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{loading ? null : auth ? children : <RepoManager />}</div>
    </div>
  );
}
