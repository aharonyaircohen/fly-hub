"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { RepoScopedLink } from "@dashboard/lib/components/RepoScopedLink";
import type { Connection } from "@dashboard/lib/connections/model";
import { CONNECTION_PROVIDERS, type ConnectionProviderDefinition } from "@dashboard/lib/connections/providers";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";

async function responseJson<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

export function ConnectionsManager() {
  return <AuthGuard><ConnectionsManagerInner /></AuthGuard>;
}

function ConnectionsManagerInner() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(
    () => ({ "Content-Type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const queryKey = ["connections", auth?.owner ?? null, auth?.repo ?? null] as const;
  const connections = useQuery({
    queryKey,
    enabled: !!auth,
    queryFn: async () => responseJson<{ connections: Connection[] }>(
      await fetch("/api/kody/connections", { headers, cache: "no-store" }),
    ),
  });
  const secrets = useQuery({
    queryKey: ["kody-secrets", auth?.owner ?? null, auth?.repo ?? null],
    enabled: !!auth,
    queryFn: async () => responseJson<{ secrets: Array<{ name: string }> }>(
      await fetch("/api/kody/secrets", { headers, cache: "no-store" }),
    ),
  });
  const updateConnection = (updated: Connection) => {
    queryClient.setQueryData<{ connections: Connection[] }>(queryKey, (current) => ({
      connections: [...(current?.connections ?? []).filter(({ id }) => id !== updated.id), updated],
    }));
  };

  return (
    <PageShell title="Connections" icon={Share2} subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}>
      <div className="max-w-2xl space-y-4">
        {connections.isLoading || secrets.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading Connections…</p>
        ) : null}
        {CONNECTION_PROVIDERS.map((provider) => (
          <ConnectionCard
            key={provider.connectionId}
            provider={provider}
            connection={connections.data?.connections.find(({ id }) => id === provider.connectionId) ?? null}
            secretConfigured={secrets.data?.secrets.some(({ name }) => name === provider.accessTokenRef) ?? false}
            headers={headers}
            actorLogin={auth?.user.login}
            onUpdated={updateConnection}
          />
        ))}
      </div>
    </PageShell>
  );
}

function ConnectionCard({ provider, connection, secretConfigured, headers, actorLogin, onUpdated }: {
  provider: ConnectionProviderDefinition;
  connection: Connection | null;
  secretConfigured: boolean;
  headers: Record<string, string>;
  actorLogin?: string;
  onUpdated(connection: Connection): void;
}) {
  const [name, setName] = useState(provider.defaultName);
  const [externalId, setExternalId] = useState("");
  useEffect(() => {
    if (!connection) return;
    setName(connection.name);
    setExternalId(connection.externalId);
  }, [connection]);
  const save = useMutation({
    mutationFn: async () => responseJson<{ connection: Connection }>(
      await fetch("/api/kody/connections", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          id: provider.connectionId,
          name: name.trim(),
          provider: provider.id,
          accountType: provider.accountType,
          externalId: externalId.trim(),
          credentialRefs: { accessToken: provider.accessTokenRef },
          actorLogin,
        }),
      }),
    ),
    onSuccess: ({ connection: saved }) => { onUpdated(saved); toast.success(`${provider.displayName} connection saved`); },
    onError: (error: Error) => toast.error(error.message),
  });
  const verify = useMutation({
    mutationFn: async () => responseJson<{ connection: Connection }>(
      await fetch(`/api/kody/connections/${provider.connectionId}/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ actorLogin }),
      }),
    ),
    onSuccess: ({ connection: verified }) => { onUpdated(verified); toast.success(`${provider.displayName} connection verified`); },
    onError: (error: Error) => toast.error(error.message),
  });
  const valid = name.trim().length > 0 && /^\d{1,32}$/.test(externalId.trim());
  const status = connection?.status === "connected" ? "Connected" : connection?.status === "disabled" ? "Disabled" : "Needs attention";

  return (
    <Card aria-label={`${provider.displayName} connection`} className="border-white/[0.08] bg-white/[0.02]">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <p className="font-medium">{provider.displayName}</p>
          <span className={connection?.status === "connected" ? "text-sm text-emerald-300" : "text-sm text-amber-300"}>{status}</span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${provider.id}-connection-name`}>Name</Label>
          <Input id={`${provider.id}-connection-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${provider.id}-external-id`}>{provider.externalIdLabel}</Label>
          <Input id={`${provider.id}-external-id`} value={externalId} onChange={(event) => setExternalId(event.target.value)} inputMode="numeric" maxLength={32} />
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <code className="text-sm">{provider.accessTokenRef}</code>
            {secretConfigured ? <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Added</span> : null}
          </div>
          <RepoScopedLink href="/secrets" className="mt-3 inline-block text-sm text-sky-300 underline">{secretConfigured ? "Manage secret" : "Add token in Secrets"}</RepoScopedLink>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!connection || !secretConfigured || verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "Verifying…" : "Verify Connection"}</Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save Connection"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
