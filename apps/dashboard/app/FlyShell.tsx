"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AppWindow, History, LogOut, PlugZap, ServerCog, Workflow } from "lucide-react";
import { ThemeSelector } from "@dashboard/providers/Theme/ThemeSelector";

const flyItems = [
  { href: "/fly/machines", label: "Machines", icon: ServerCog },
  { href: "/fly/apps", label: "Apps", icon: AppWindow },
  { href: "/fly/history", label: "History", icon: History },
] as const;

type Session = { connected: boolean; orgSlug: string | null };

export function FlyShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mcpGrant, setMcpGrant] = useState<{ bearerToken: string; expiresAt: number } | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpScopes, setMcpScopes] = useState<Array<"read" | "manage" | "command">>(["read"]);

  useEffect(() => {
    let active = true;
    void fetch("/api/fly-hub/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((value: Session) => { if (active) setSession(value); })
      .catch(() => { if (active) setSession({ connected: false, orgSlug: null }); });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/fly-hub/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = (await response.json()) as Session & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not connect to Fly.");
      setToken("");
      setSession({ connected: true, orgSlug: result.orgSlug });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to Fly.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/fly-hub/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disconnect Fly.");
      setSession({ connected: false, orgSlug: null });
      setMcpGrant(null);
      window.location.assign("/fly/machines");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Fly.");
    } finally {
      setBusy(false);
    }
  }

  async function createMcpGrant() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/fly-hub/mcp-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes: mcpScopes }),
      });
      const result = await response.json() as { bearerToken?: string; expiresAt?: number; error?: string };
      if (!response.ok || !result.bearerToken || !result.expiresAt) throw new Error(result.error ?? "Could not create chat credential.");
      setMcpGrant({ bearerToken: result.bearerToken, expiresAt: result.expiresAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create chat credential.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return <div className="fly-hub fly-hub--signed-out"><div className="fly-hub__content">Checking Fly connection…</div></div>;
  }

  if (!session.connected) {
    return (
      <div className="fly-hub fly-hub--signed-out">
        <header className="fly-hub__signed-out-header">
          <Link href="/fly/machines" className="fly-hub__brand">
            <span className="fly-hub__brand-mark"><Workflow size={19} strokeWidth={2.4} /></span>
            <span>Fly Hub</span>
          </Link>
          <ThemeSelector />
        </header>
        <main className="fly-hub__content flex min-h-[70vh] items-center justify-center px-6">
          <form onSubmit={(event) => void signIn(event)} className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold">Connect to Fly Hub</h1>
            <p className="mt-2 text-sm text-muted-foreground">Enter your Fly API token to manage machines. This browser will remember it.</p>
            <label htmlFor="fly-token" className="mt-6 block text-sm font-medium">Fly API token</label>
            <input id="fly-token" type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" />
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <button type="submit" disabled={busy} className="mt-5 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Connecting…" : "Connect Fly"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="fly-hub">
      <aside className="fly-hub__sidebar">
        <Link href="/fly/machines" className="fly-hub__brand">
          <span className="fly-hub__brand-mark"><Workflow size={19} strokeWidth={2.4} /></span>
          <span>Fly Hub</span>
        </Link>
        <div className="fly-hub__sidebar-label">Workspace</div>
        <nav aria-label="Fly pages" className="fly-hub__nav">
          {flyItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`fly-hub__nav-link${active ? " is-active" : ""}`}>
                <Icon size={18} strokeWidth={1.9} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="fly-hub__sidebar-foot"><div className="fly-hub__sidebar-foot-dot" />Fly infrastructure</div>
      </aside>
      <div className="fly-hub__main">
        <header className="fly-hub__topbar">
          <div className="fly-hub__topbar-title"><span className="fly-hub__eyebrow">Control plane</span><span>Machine management</span></div>
          <div className="fly-hub__topbar-actions">
            <span className="fly-hub__org text-sm text-muted-foreground">{session.orgSlug}</span>
            <button type="button" className="fly-hub__sign-out" aria-label="Connect chat" title="Connect chat" onClick={() => { setMcpGrant(null); setMcpOpen(true); }}><PlugZap size={17} /></button>
            <ThemeSelector />
            <button type="button" disabled={busy} className="fly-hub__sign-out" aria-label="Disconnect" title="Disconnect" onClick={() => void signOut()}><LogOut size={17} /></button>
          </div>
        </header>
        {mcpOpen && <div role="dialog" aria-modal="true" aria-label="Connect chat to Fly Hub" className="mx-4 mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Connect chat to Fly Hub</h2><button type="button" onClick={() => { setMcpOpen(false); setMcpGrant(null); }}>Close</button></div>
          <p className="mt-2 text-sm text-muted-foreground">Add this MCP server URL to your chat client: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/fly-hub/mcp` : "/api/fly-hub/mcp"}</code></p>
          <p className="mt-2 text-sm text-muted-foreground">Select what the chat can do. The credential expires after 15 minutes; anyone holding it can use these permissions until then.</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {(["read", "manage", "command"] as const).map((scope) => <label key={scope} className="flex items-center gap-2"><input type="checkbox" checked={mcpScopes.includes(scope)} onChange={(event) => { setMcpGrant(null); setMcpScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope)); }} />{scope === "read" ? "View machines" : scope === "manage" ? "Create and manage machines" : "Run commands"}</label>)}
          </div>
          <button type="button" disabled={busy || mcpScopes.length === 0} onClick={() => void createMcpGrant()} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Create credential</button>
          {mcpGrant && <div className="mt-4"><label htmlFor="fly-mcp-token" className="block text-sm font-medium">Bearer token (shown until you close this panel)</label><textarea id="fly-mcp-token" readOnly value={mcpGrant.bearerToken} rows={3} className="mt-1 w-full rounded-md border bg-background p-2 font-mono text-xs" onFocus={(event) => event.target.select()} /><p className="text-xs text-muted-foreground">Expires {new Date(mcpGrant.expiresAt).toLocaleString()}. Configure your client to send it as an Authorization: Bearer header.</p></div>}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>}
        <main className="fly-hub__content">{children}</main>
      </div>
    </div>
  );
}
