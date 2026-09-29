"use client";

import { useEffect, useState } from "react";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";

type Plan = {
  repository: string;
  name: string;
  appName: string;
  commitSha: string;
  branch: string;
  plan: {
    kind: string;
    rootDirectory: string;
    buildCommand?: string;
    startCommand?: string;
    port?: number;
    questions?: string[];
    generatedSecretNames?: string[];
  };
  requiredSecretNames: string[];
};
type App = {
  appName: string;
  name: string;
  repository: string;
  commitSha: string;
  state: string;
  url: string;
};
type Pending = {
  appName: string;
  url: string;
  password: string;
  status: string;
  message: string;
};

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (HTTP ${response.status}).`);
  return body;
}

export function FlyAppsManager() {
  const [url, setUrl] = useState("");
  const [rootDirectory, setRootDirectory] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingStatus, setPendingStatus] = useState<
    "building" | "failed" | null
  >(null);
  const [pendingReady, setPendingReady] = useState(false);
  const [newPassword, setNewPassword] = useState<{
    appName: string;
    password: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pendingAppName = pending?.appName;

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const data = await json<{
          apps: App[];
          pendingStatus: { state: "building" | "failed" } | null;
          pendingReady: boolean;
        }>(
          await fetch(
            `/api/fly-hub/apps${pendingAppName ? `?pending=${encodeURIComponent(pendingAppName)}` : ""}`,
            { cache: "no-store" },
          ),
        );
        if (active) {
          setApps(data.apps);
          setPendingStatus(data.pendingStatus?.state ?? null);
          setPendingReady(data.pendingReady);
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load apps.",
          );
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pendingAppName]);

  async function inspect() {
    setBusy("inspect");
    setError("");
    setPlan(null);
    setPending(null);
    setPendingStatus(null);
    try {
      const result = await json<Plan>(
        await fetch("/api/fly-hub/apps/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, rootDirectory }),
        }),
      );
      setPlan(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not inspect repo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deploy() {
    if (!plan) return;
    setBusy("deploy");
    setError("");
    try {
      const result = await json<Pending>(
        await fetch("/api/fly-hub/apps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            rootDirectory,
            commitSha: plan.commitSha,
          }),
        }),
      );
      setPending(result);
      setPlan(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start deployment.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(appName: string) {
    setBusy(appName);
    setError("");
    setNewPassword(null);
    try {
      const result = await json<{ password: string }>(
        await fetch(
          `/api/fly-hub/apps/${encodeURIComponent(appName)}/password`,
          { method: "POST" },
        ),
      );
      setNewPassword({ appName, password: result.password });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reset password.",
      );
    } finally {
      setBusy(null);
    }
  }

  const canDeploy =
    plan &&
    plan.plan.kind !== "unsupported" &&
    !plan.plan.questions?.length &&
    !plan.requiredSecretNames.length &&
    !plan.plan.generatedSecretNames?.length;
  const pendingApp =
    pending && apps.find((app) => app.appName === pending.appName);

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-3">
      <header>
        <h1 className="text-2xl font-semibold">Apps</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Deploy a public GitHub repository to this Fly organization. Each app
          gets one shared password.
        </p>
      </header>
      <section className="rounded-xl border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Deploy from GitHub</h2>
          <p className="text-sm text-muted-foreground">
            Fly Hub checks how to build and run the repository before
            deployment.
          </p>
        </div>
        <label className="block text-sm font-medium">
          Repository URL
          <Input
            type="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setPlan(null);
            }}
            placeholder="https://github.com/owner/repo"
            className="mt-2"
          />
        </label>
        <label className="block text-sm font-medium">
          App directory{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <Input
            value={rootDirectory}
            onChange={(event) => {
              setRootDirectory(event.target.value);
              setPlan(null);
            }}
            placeholder="Root of repository"
            className="mt-2"
          />
        </label>
        <Button
          type="button"
          disabled={!url.trim() || busy !== null}
          onClick={() => void inspect()}
        >
          {busy === "inspect" ? "Inspecting…" : "Inspect repository"}
        </Button>
        {plan && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <h3 className="font-semibold">Deployment plan</h3>
            <p>
              <strong>Source:</strong> {plan.repository} · {plan.branch} ·{" "}
              {plan.commitSha.slice(0, 12)}
            </p>
            <p>
              <strong>App:</strong> {plan.appName}
            </p>
            <p>A private runtime machine and a public password gateway will be created in your Fly organization.</p>
            <p>
              <strong>Detected:</strong> {plan.plan.kind} · directory{" "}
              {plan.plan.rootDirectory} · port {plan.plan.port ?? "automatic"}
            </p>
            {plan.plan.buildCommand && (
              <p>
                <strong>Build:</strong> {plan.plan.buildCommand}
              </p>
            )}
            {plan.plan.startCommand && (
              <p>
                <strong>Start:</strong> {plan.plan.startCommand}
              </p>
            )}
            {plan.requiredSecretNames.length > 0 && (
              <p className="text-destructive">
                Required secrets: {plan.requiredSecretNames.join(", ")}. Secret
                setup is coming later.
              </p>
            )}
            {!!plan.plan.generatedSecretNames?.length && (
              <p className="text-destructive">
                Generated secrets needed:{" "}
                {plan.plan.generatedSecretNames.join(", ")}. Secret setup is
                coming later.
              </p>
            )}
            {plan.plan.questions?.map((question) => (
              <p key={question} className="text-destructive">
                {question}
              </p>
            ))}
            <Button
              type="button"
              disabled={!canDeploy || busy !== null}
              onClick={() => void deploy()}
            >
              {busy === "deploy"
                ? "Starting…"
                : "Deploy password-protected app"}
            </Button>
          </div>
        )}
        {pending && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2 text-sm">
            <h3 className="font-semibold">
              {pendingReady
                ? "App ready"
                : pendingStatus === "failed" && !pendingApp
                  ? "Build failed"
                  : "Building app"}
            </h3>
            <p>
              {pendingReady
                ? "Open the URL and enter the password below."
                : pendingStatus === "failed" && !pendingApp
                  ? "The builder stopped before the app became available. Check its Fly machine logs, then inspect and deploy again."
                  : "This may take a few minutes. The URL will work after the build and health check complete."}
            </p>
            <a
              href={pending.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {pending.url}
            </a>
            <p>
              <strong>Shared password:</strong>{" "}
              <code className="select-all break-all rounded bg-background px-2 py-1">
                {pending.password}
              </code>
            </p>
            <p>{pending.message}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Deployed apps</h2>
        {apps.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No Fly Hub apps in this organization yet.
          </p>
        )}
        {apps.map((app) => (
          <div
            key={app.appName}
            className="rounded-xl border bg-card p-4 text-sm space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{app.name}</strong>
              <span className="rounded-full border px-2 py-0.5 text-xs">
                {app.state}
              </span>
            </div>
            <p className="text-muted-foreground">
              {app.repository} · {app.commitSha.slice(0, 12)}
            </p>
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {app.url}
            </a>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void resetPassword(app.appName)}
              >
                {busy === app.appName ? "Resetting…" : "Reset password"}
              </Button>
            </div>
            {newPassword?.appName === app.appName && (
              <p role="status">
                New shared password:{" "}
                <code className="select-all break-all rounded bg-muted px-2 py-1">
                  {newPassword.password}
                </code>{" "}
                — save it now. Previous sessions are revoked.
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
