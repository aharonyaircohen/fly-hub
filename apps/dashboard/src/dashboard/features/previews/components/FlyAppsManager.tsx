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
  instructions?: string;
  appCredential?: { name: string; password: string } | null;
};
type EvePlan = {
  summary: string;
  usage: string;
  credentialNotes: string;
  service: string;
  rootDirectory: string;
  startCommand?: string | null;
  port?: number | null;
  persistentPaths: string[];
  requiredSecrets: string[];
  generatedSecrets: string[];
  appPasswordEnv?: string | null;
  runtimeEnv: Record<string, string>;
  questions: string[];
  verificationPath: string;
  evidence: string[];
};
type EveApp = {
  appName: string;
  url: string;
  ready: boolean;
  buildStatus: string | null;
  buildError?: string | null;
  password: string | null;
  appCredential: { name: string; password: string } | null;
};
type EveInputRequest = {
  requestId: string;
  kind?: string;
  prompt?: string;
  question?: string;
  options?: Array<{ id: string; label?: string; description?: string }>;
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
  const [setupPrompt, setSetupPrompt] = useState("");
  const [agentHandle, setAgentHandle] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<string | null>(null);
  const [agentApp, setAgentApp] = useState<EveApp | null>(null);
  const [agentResult, setAgentResult] = useState<unknown>(null);
  const [agentPlan, setAgentPlan] = useState<EvePlan | null>(null);
  const [agentPlanError, setAgentPlanError] = useState<string | null>(null);
  const [agentCommitSha, setAgentCommitSha] = useState<string | null>(null);
  const [agentSourceSecrets, setAgentSourceSecrets] = useState<string[]>([]);
  const [agentSecrets, setAgentSecrets] = useState<Record<string, string>>({});
  const [agentInputs, setAgentInputs] = useState<
    Record<string, EveInputRequest>
  >({});
  const [agentAnswers, setAgentAnswers] = useState<Record<string, string>>({});
  const [agentAuthorization, setAgentAuthorization] = useState<unknown>(null);
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
    const saved = window.sessionStorage.getItem("flyhub:eve-app-task");
    if (!saved) return;
    try {
      const value = JSON.parse(saved) as { handle?: string; url?: string };
      if (value.handle && value.url) {
        setAgentHandle(value.handle);
        setUrl(value.url);
      }
    } catch {
      window.sessionStorage.removeItem("flyhub:eve-app-task");
    }
  }, []);

  useEffect(() => {
    if (!agentHandle) return;
    let active = true;
    async function refresh() {
      try {
        const data = await json<{
          status: string;
          mode?: string;
          app?: EveApp;
          result: unknown;
          error?: string | { message?: string } | null;
          plan?: EvePlan | null;
          planError?: string | null;
          inputRequests?: Record<string, EveInputRequest> | null;
          authorization?: unknown;
        }>(
          await fetch(
            `/api/fly-hub/apps/agent?handle=${encodeURIComponent(agentHandle!)}`,
            { cache: "no-store" },
          ),
        );
        if (!active) return;
        setAgentState(data.status);
        setAgentMode(data.mode ?? null);
        setAgentApp(data.app ?? null);
        if (data.result != null) setAgentResult(data.result);
        if (data.plan) setAgentPlan(data.plan);
        if (data.planError) setAgentPlanError(data.planError);
        setAgentInputs(data.inputRequests ?? {});
        setAgentAuthorization(data.authorization ?? null);
        if (data.status === "failed")
          setError(
            typeof data.error === "string"
              ? data.error
              : data.error?.message || "Eve could not complete app setup.",
          );
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read Eve's plan.",
          );
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (
        (agentState !== "completed" &&
          agentState !== "failed" &&
          agentState !== "cancelled") ||
        (agentState === "completed" && agentApp?.buildStatus === "building")
      )
        void refresh();
    }, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [agentHandle, agentState, agentApp?.buildStatus]);

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

  async function planWithEve() {
    setBusy("agent");
    setError("");
    setAgentHandle(null);
    setAgentState(null);
    setAgentMode(null);
    setAgentApp(null);
    setAgentResult(null);
    setAgentPlan(null);
    setAgentPlanError(null);
    setAgentSecrets({});
    setAgentInputs({});
    setAgentAnswers({});
    setAgentAuthorization(null);
    setPlan(null);
    try {
      const result = await json<{
        handle: string;
        status: string;
        mode?: string;
        commitSha?: string;
        requiredSecretNames?: string[];
      }>(
        await fetch("/api/fly-hub/apps/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, prompt: setupPrompt }),
        }),
      );
      setAgentHandle(result.handle);
      window.sessionStorage.setItem(
        "flyhub:eve-app-task",
        JSON.stringify({ handle: result.handle, url }),
      );
      setAgentState(result.status);
      setAgentMode(result.mode ?? null);
      setAgentCommitSha(result.commitSha ?? null);
      setAgentSourceSecrets(result.requiredSecretNames ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Eve.");
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

  async function deployEvePlan() {
    if (!agentHandle || !agentPlan) return;
    setBusy("deploy");
    setError("");
    try {
      const result = await json<Pending>(
        await fetch("/api/fly-hub/apps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eveHandle: agentHandle,
            runtimeSecrets: agentSecrets,
          }),
        }),
      );
      setPending(result);
      setAgentSecrets({});
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start deployment.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function answerEve() {
    if (!agentHandle) return;
    setBusy("answer");
    setError("");
    try {
      const responses = Object.values(agentInputs).map((request) => {
        const value = agentAnswers[request.requestId] ?? "";
        return request.options?.length
          ? { requestId: request.requestId, optionId: value }
          : { requestId: request.requestId, text: value };
      });
      await json(
        await fetch("/api/fly-hub/apps/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "answer",
            handle: agentHandle,
            responses,
          }),
        }),
      );
      setAgentState("working");
      setAgentInputs({});
      setAgentAnswers({});
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not answer Eve.",
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
  const requiredAgentSecrets = agentPlan
    ? [
        ...new Set([...agentSourceSecrets, ...agentPlan.requiredSecrets]),
      ].filter(
        (name) =>
          name !== agentPlan.appPasswordEnv &&
          !agentPlan.generatedSecrets.includes(name),
      )
    : [];

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
              setAgentHandle(null);
              window.sessionStorage.removeItem("flyhub:eve-app-task");
              setAgentResult(null);
              setAgentPlan(null);
            }}
            placeholder="https://github.com/owner/repo"
            className="mt-2"
          />
        </label>
        <label className="block text-sm font-medium">
          What should the app do?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <textarea
            value={setupPrompt}
            onChange={(event) => setSetupPrompt(event.target.value)}
            maxLength={5_000}
            rows={3}
            placeholder="For example: open the web dashboard, keep its data, and explain any credentials I need."
            className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!url.trim() || busy !== null}
            onClick={() => void planWithEve()}
          >
            {busy === "agent" ? "Starting Eve…" : "Set up with Eve"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!url.trim() || busy !== null}
            onClick={() => void inspect()}
          >
            {busy === "inspect" ? "Inspecting…" : "Inspect files"}
          </Button>
        </div>
        {agentHandle && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <h3 className="font-semibold">
              {agentMode === "deployment"
                ? "Eve app setup"
                : "Eve deployment plan"}
            </h3>
            <p role="status">
              {agentState === "completed"
                ? agentMode === "deployment"
                  ? "Eve finished. Review the app status and its instructions below."
                  : "Plan complete. Review the setup and missing inputs below."
                : agentState === "failed"
                  ? "Eve could not finish app setup."
                  : agentState === "input_required"
                    ? "Eve needs your answer to continue."
                    : agentState === "authorization_required"
                      ? "Eve needs a connected account to continue."
                      : agentMode === "deployment"
                        ? "Eve is setting up the app and checking its result…"
                        : "Eve is reading the repository and planning its setup…"}
            </p>
            {agentApp && (
              <div className="rounded-md border bg-background p-3 space-y-2">
                <p>
                  <strong>App:</strong>{" "}
                  <a
                    href={agentApp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {agentApp.url}
                  </a>
                </p>
                {agentApp.buildStatus === "failed" && agentApp.buildError && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-destructive">
                    {agentApp.buildError}
                  </pre>
                )}
                <p>
                  {agentApp.ready
                    ? "App ready"
                    : agentApp.buildStatus === "failed"
                      ? "Build failed. Eve can inspect the failure and retry."
                      : agentApp.buildStatus === "building"
                        ? "Building app…"
                        : agentState === "completed"
                          ? "Eve finished without starting a build. Review its explanation below."
                        : "Waiting for Eve to start the build."}
                </p>
                {agentApp.password && (
                  <p>
                    <strong>Fly Hub password:</strong>{" "}
                    <code className="select-all break-all">
                      {agentApp.password}
                    </code>
                  </p>
                )}
                {agentApp.appCredential && (
                  <p>
                    <strong>
                      App login password ({agentApp.appCredential.name}):
                    </strong>{" "}
                    <code className="select-all break-all">
                      {agentApp.appCredential.password}
                    </code>
                  </p>
                )}
              </div>
            )}
            {agentState === "input_required" &&
              Object.values(agentInputs).map((request) => (
                <label key={request.requestId} className="block font-medium">
                  {request.prompt ||
                    request.question ||
                    request.kind ||
                    "Eve question"}
                  {request.options?.length ? (
                    <select
                      value={agentAnswers[request.requestId] ?? ""}
                      onChange={(event) =>
                        setAgentAnswers((current) => ({
                          ...current,
                          [request.requestId]: event.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                    >
                      <option value="">Choose an answer</option>
                      {request.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label || option.description || option.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      value={agentAnswers[request.requestId] ?? ""}
                      onChange={(event) =>
                        setAgentAnswers((current) => ({
                          ...current,
                          [request.requestId]: event.target.value,
                        }))
                      }
                      rows={2}
                      className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                    />
                  )}
                </label>
              ))}
            {agentState === "input_required" &&
              Object.keys(agentInputs).length > 0 && (
                <Button
                  type="button"
                  disabled={
                    busy !== null ||
                    Object.values(agentInputs).some(
                      (request) => !agentAnswers[request.requestId]?.trim(),
                    )
                  }
                  onClick={() => void answerEve()}
                >
                  {busy === "answer" ? "Sending…" : "Continue setup"}
                </Button>
              )}
            {agentState === "authorization_required" &&
              agentAuthorization != null && (
                <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs">
                  {JSON.stringify(agentAuthorization, null, 2)}
                </pre>
              )}
            {agentPlan && (
              <div className="space-y-2">
                <p>{agentPlan.summary}</p>
                {agentPlan.usage && <p>{agentPlan.usage}</p>}
                {agentPlan.credentialNotes && (
                  <p>{agentPlan.credentialNotes}</p>
                )}
                <p>
                  <strong>Service:</strong> {agentPlan.service}
                </p>
                <p>
                  <strong>Source:</strong> {agentPlan.rootDirectory} ·{" "}
                  {agentCommitSha?.slice(0, 12) ?? "commit not pinned"}
                </p>
                <p>
                  <strong>Start:</strong>{" "}
                  {agentPlan.startCommand || "repository default"} · port{" "}
                  {agentPlan.port ?? "unknown"}
                </p>
                <p>
                  <strong>Storage:</strong>{" "}
                  {agentPlan.persistentPaths.length
                    ? `${agentPlan.persistentPaths.join(", ")} on a 1 GB Fly volume`
                    : "No persistent volume proposed"}
                </p>
                {agentPlan.appPasswordEnv && (
                  <p>
                    Fly Hub will generate a separate app login password for{" "}
                    {agentPlan.appPasswordEnv}.
                  </p>
                )}
                {agentPlan.generatedSecrets.length > 0 && (
                  <p>
                    Fly Hub will generate:{" "}
                    {agentPlan.generatedSecrets.join(", ")}.
                  </p>
                )}
                {agentPlan.questions.map((question) => (
                  <p key={question} className="text-destructive">
                    {question}
                  </p>
                ))}
                {requiredAgentSecrets.map((name) => (
                  <label key={name} className="block font-medium">
                    {name}
                    <Input
                      type="password"
                      autoComplete="off"
                      value={agentSecrets[name] ?? ""}
                      onChange={(event) =>
                        setAgentSecrets((current) => ({
                          ...current,
                          [name]: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                ))}
                <p className="text-muted-foreground">
                  Secrets go to Fly at deployment and are not sent to Eve.
                </p>
                <Button
                  type="button"
                  disabled={
                    busy !== null ||
                    !agentCommitSha ||
                    !agentPlan.port ||
                    agentPlan.questions.length > 0 ||
                    requiredAgentSecrets.some(
                      (name) => !agentSecrets[name]?.trim(),
                    )
                  }
                  onClick={() => void deployEvePlan()}
                >
                  {busy === "deploy" ? "Starting…" : "Deploy Eve plan"}
                </Button>
              </div>
            )}
            {agentPlanError && (
              <p className="text-destructive">
                Eve's plan needs revision: {agentPlanError}
              </p>
            )}
            {!agentPlan && agentResult != null && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs">
                {typeof agentResult === "string"
                  ? agentResult
                  : JSON.stringify(agentResult, null, 2)}
              </pre>
            )}
          </div>
        )}
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
            <p>
              A private runtime machine and a public password gateway will be
              created in your Fly organization.
            </p>
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
            {pending.appCredential && (
              <p>
                <strong>
                  App login password ({pending.appCredential.name}):
                </strong>{" "}
                <code className="select-all break-all rounded bg-background px-2 py-1">
                  {pending.appCredential.password}
                </code>
              </p>
            )}
            <p>{pending.message}</p>
            {pending.instructions && (
              <p className="whitespace-pre-wrap">{pending.instructions}</p>
            )}
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
