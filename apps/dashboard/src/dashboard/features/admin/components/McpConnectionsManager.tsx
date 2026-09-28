/**
 * @fileType component
 * @domain mcp
 * @pattern standard-content-manager
 * @ai-summary Repository-scoped setup for connecting any standards-compliant
 *   MCP coding agent to Kody. Tokens are shown once and never persisted here.
 */
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";

type McpToken = {
  tokenId: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

type CreatedConnection = {
  accessToken: string;
  token: McpToken;
  verified: boolean;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function McpConnectionsManager() {
  return (
    <AuthGuard>
      <McpConnectionsManagerInner />
    </AuthGuard>
  );
}

function McpConnectionsManagerInner() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Coding agent");
  const [access, setAccess] = useState<"read" | "execute">("read");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [memoryScope, setMemoryScope] = useState<"repository" | "all">(
    "repository",
  );
  const [allowMemoryDelete, setAllowMemoryDelete] = useState(false);
  const [created, setCreated] = useState<CreatedConnection | null>(null);
  const headers = useMemo(
    () => ({ "Content-Type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const queryKey = ["mcp-connections", auth?.owner, auth?.repo] as const;
  const endpoint =
    typeof window === "undefined"
      ? "/api/kody/mcp"
      : `${window.location.origin}/api/kody/mcp`;

  const tokens = useQuery({
    queryKey,
    enabled: Boolean(auth),
    queryFn: async () =>
      responseJson<{ tokens: McpToken[] }>(
        await fetch("/api/kody/mcp/tokens", { headers, cache: "no-store" }),
      ),
  });

  const createConnection = useMutation({
    mutationFn: async () => {
      const issued = await responseJson<{
        accessToken: string;
        token: McpToken;
      }>(
        await fetch("/api/kody/mcp/tokens", {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: name.trim(),
            access,
            expiresInDays,
            memoryScope,
            allowMemoryDelete,
          }),
        }),
      );
      const check = await fetch("/api/kody/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${issued.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "dashboard-check",
          method: "tools/call",
          params: { name: "kody_status", arguments: {} },
        }),
      });
      const checked = (await check.json().catch(() => ({}))) as {
        result?: { isError?: boolean; structuredContent?: { status?: string } };
      };
      return {
        ...issued,
        verified:
          check.ok &&
          checked.result?.isError === false &&
          checked.result.structuredContent?.status === "ready",
      };
    },
    onSuccess: async (value) => {
      setCreated(value);
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeConnection = useMutation({
    mutationFn: async (tokenId: string) =>
      responseJson<{ ok: true }>(
        await fetch("/api/kody/mcp/tokens", {
          method: "DELETE",
          headers,
          body: JSON.stringify({ tokenId }),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Agent connection revoked");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const configuration = JSON.stringify(
    {
      name: "kody",
      transport: "http",
      url: endpoint,
      headers: { Authorization: "Bearer ${KODY_MCP_TOKEN}" },
    },
    null,
    2,
  );

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  return (
    <PageShell
      title="Agent connections"
      icon={Plug}
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <Button
          disabled={!auth?.token || !auth.owner || !auth.repo}
          onClick={() => setCreating(true)}
        >
          Create connection
        </Button>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="font-medium">Works with any MCP client</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Give the client this endpoint and keep the token in an
                environment variable.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Connection configuration</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(configuration, "Configuration")}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-black/30 p-4 text-xs text-white/75">
                {configuration}
              </pre>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-3" aria-labelledby="active-connections">
          <h2 id="active-connections" className="font-medium">
            Active connections
          </h2>
          {tokens.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
            </p>
          ) : tokens.isError ? (
            <p className="text-sm text-destructive">{tokens.error.message}</p>
          ) : (tokens.data?.tokens.filter((token) => !token.revokedAt).length ??
              0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agent connections yet
            </p>
          ) : (
            tokens.data?.tokens
              .filter((token) => !token.revokedAt)
              .map((token) => (
                <Card key={token.tokenId}>
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium">{token.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {token.scopes.includes("mcp:execute")
                          ? "Read and request changes"
                          : "Read only"}{" "}
                        · expires{" "}
                        {new Date(token.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${token.name}`}
                      disabled={revokeConnection.isPending}
                      onClick={() => revokeConnection.mutate(token.tokenId)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))
          )}
        </section>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create agent connection</DialogTitle>
            <DialogDescription>
              Create a repository-scoped token for one MCP client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-connection-name">Connection name</Label>
              <Input
                id="mcp-connection-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-access">Access</Label>
              <select
                id="mcp-access"
                value={access}
                onChange={(event) =>
                  setAccess(event.target.value as "read" | "execute")
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="read">Read only</option>
                <option value="execute">Read and request changes</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-memory-scope">Memory access</Label>
              <select
                id="mcp-memory-scope"
                value={memoryScope}
                onChange={(event) =>
                  setMemoryScope(event.target.value as "repository" | "all")
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="repository">This project only</option>
                <option value="all">This project and personal memory</option>
              </select>
            </div>
            {access === "execute" ? (
              <label className="flex items-center gap-2 text-sm">
                <Input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allowMemoryDelete}
                  onChange={(event) =>
                    setAllowMemoryDelete(event.target.checked)
                  }
                />
                Allow deleting memories and their history
              </label>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="mcp-expiry">Expires</Label>
              <select
                id="mcp-expiry"
                value={expiresInDays}
                onChange={(event) =>
                  setExpiresInDays(Number(event.target.value))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>
            <Button
              className="w-full"
              disabled={
                !auth?.token ||
                !auth.owner ||
                !auth.repo ||
                !name.trim() ||
                createConnection.isPending
              }
              onClick={() => createConnection.mutate()}
            >
              {createConnection.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create token
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(created)} onOpenChange={() => setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this token now</DialogTitle>
            <DialogDescription>
              Kody will not show the token again.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-4">
              <div
                className={`flex items-center gap-2 text-sm ${
                  created.verified ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {created.verified ? <CheckCircle2 className="h-4 w-4" /> : null}
                {created.verified
                  ? "Connection ready"
                  : "Token created; automatic connection check failed"}
              </div>
              <div className="space-y-2">
                <Label>Token</Label>
                <div className="flex gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-black/30 p-3 text-xs">
                    {created.accessToken}
                  </code>
                  <Button
                    variant="outline"
                    onClick={() => copy(created.accessToken, "Token")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded-md bg-black/30 p-4 text-xs text-white/75">
                {configuration}
              </pre>
              <Button className="w-full" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
