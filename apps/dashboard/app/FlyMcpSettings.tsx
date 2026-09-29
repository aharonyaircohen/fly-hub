"use client";

import { useState } from "react";

type Scope = "read" | "manage" | "command";

const scopeOptions: Array<{ id: Scope; label: string; detail: string }> = [
  { id: "read", label: "View machines", detail: "List machines and inspect their status." },
  { id: "manage", label: "Manage machines", detail: "Create, start, suspend, and destroy machines." },
  { id: "command", label: "Run commands", detail: "Execute noninteractive shell commands on Fly Hub machines." },
];

export function FlyMcpSettings() {
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [grant, setGrant] = useState<{ bearerToken: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = typeof window === "undefined" ? "/api/fly-hub/mcp" : `${window.location.origin}/api/fly-hub/mcp`;

  async function createGrant() {
    setBusy(true);
    setError("");
    setGrant(null);
    try {
      const response = await fetch("/api/fly-hub/mcp-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes }),
      });
      const result = await response.json() as { bearerToken?: string; expiresAt?: number; error?: string };
      if (!response.ok || !result.bearerToken || !result.expiresAt) throw new Error(result.error ?? "Could not create an MCP credential.");
      setGrant({ bearerToken: result.bearerToken, expiresAt: result.expiresAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create an MCP credential.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl p-6 sm:p-10">
      <div className="fly-page-header"><div><h1>Settings</h1><span>Connect Fly Hub to chat</span></div></div>
      <div className="mt-6 rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">MCP connection</h2>
        <p className="mt-2 text-sm text-muted-foreground">Add this server URL to your MCP client and provide a short lived bearer credential.</p>
        <label htmlFor="fly-mcp-endpoint" className="mt-5 block text-sm font-medium">Server URL</label>
        <input id="fly-mcp-endpoint" readOnly value={endpoint} className="mt-2 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" onFocus={(event) => event.target.select()} />
        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Chat permissions</legend>
          <div className="mt-2 grid gap-2">
            {scopeOptions.map((option) => <label key={option.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={scopes.includes(option.id)} onChange={(event) => { setGrant(null); setScopes((current) => event.target.checked ? [...current, option.id] : current.filter((scope) => scope !== option.id)); }} />
              <span><span className="block font-medium">{option.label}</span><span className="text-muted-foreground">{option.detail}</span></span>
            </label>)}
          </div>
        </fieldset>
        <p className="mt-4 text-sm text-muted-foreground">Anyone holding this credential can use its selected permissions until it expires after 15 minutes. Enable human approval for create, destroy, and command tools in your MCP client.</p>
        <button type="button" disabled={busy || scopes.length === 0} onClick={() => void createGrant()} className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Creating…" : "Create credential"}</button>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {grant && <div className="mt-6 rounded-md border p-4">
          <label htmlFor="fly-mcp-token" className="block text-sm font-medium">Bearer token</label>
          <textarea id="fly-mcp-token" readOnly value={grant.bearerToken} rows={3} className="mt-2 w-full rounded-md border bg-background p-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
          <p className="mt-2 text-xs text-muted-foreground">Expires {new Date(grant.expiresAt).toLocaleString()}. Configure your client to send this value in its Authorization: Bearer header. It disappears when you leave this page.</p>
        </div>}
      </div>
    </section>
  );
}
