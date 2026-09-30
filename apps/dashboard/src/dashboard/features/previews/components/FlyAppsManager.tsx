"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { SavedAppsManager, type SaveAppRequest } from "./SavedAppsManager";

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
  passwordAvailable: boolean;
  appCredentialName: string | null;
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
type RunProgress = { stage: string; explanation: string };
type MachineEvent = { type: string; status: string; source: string; timestamp: number; exitCode?: number; oomKilled?: boolean };
type RunMachine = { id: string; state: string; region?: string; reason?: string | null; events?: MachineEvent[] };
type RunMachines = {
  builder: { id: string | null; state: string | null; startedAt: string | null; error: string | null; reason?: string | null; events?: MachineEvent[] } | null;
  gateway: RunMachine | null;
  runtime: RunMachine | null;
};
type RunSummary = {
  handle: string;
  url: string;
  prompt?: string;
  runId: string;
  startedAt: number | null;
  status: string;
  mode?: string;
  progress?: RunProgress;
  checkedAt?: number;
};
type EveFailure = { code?: number; message?: string; data?: {
  eveCode?: string; errorId?: string; semanticErrorId?: string;
  vercelDeploymentId?: string; hint?: string; name?: string;
} };
type EveTrace = { events: Array<{ index: number; at: string; type: string; summary: string }>; nextOffset: number; hasMore: boolean };
const runHistoryKey = "flyhub:eve-app-runs";
type EveInputRequest = {
  requestId: string;
  kind?: string;
  toolName?: string;
  prompt?: string;
  question?: string;
  options?: Array<{ id: string; label?: string; description?: string }>;
};

function MachineEvents({ machines }: { machines: RunMachines }) {
  const groups = [
    { label: "Builder", events: machines.builder?.events ?? [] },
    { label: "App runtime", events: machines.runtime?.events ?? [] },
    { label: "Password gateway", events: machines.gateway?.events ?? [] },
  ];
  if (!groups.some((group) => group.events.length)) return null;
  return <details className="text-xs"><summary className="cursor-pointer">Recent Fly machine events</summary>
    {groups.filter((group) => group.events.length).map((group) => <div key={group.label} className="mt-2">
      <strong>{group.label}</strong>
      <ul className="list-disc pl-5">
        {group.events.map((event, index) => <li key={`${event.timestamp}-${index}`}>
          {new Date(event.timestamp).toLocaleString()}: {event.type} · {event.status} · {event.source}
          {typeof event.exitCode === "number" ? ` · exit ${event.exitCode}` : ""}
          {event.oomKilled ? " · out of memory" : ""}
        </li>)}
      </ul>
    </div>)}
  </details>;
}

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
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [agentCheckedAt, setAgentCheckedAt] = useState<number | null>(null);
  const [agentProgress, setAgentProgress] = useState<RunProgress | null>(null);
  const [agentMachines, setAgentMachines] = useState<RunMachines | null>(null);
  const [agentFailure, setAgentFailure] = useState<string | null>(null);
  const [agentFailureDetails, setAgentFailureDetails] = useState<EveFailure["data"] | null>(null);
  const [agentTrace, setAgentTrace] = useState<EveTrace | null>(null);
  const traceCursor = useRef({ handle: "", offset: 0 });
  const [agentRefresh, setAgentRefresh] = useState(0);
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
  const resumedApproval = useRef<string | null>(null);
  const [agentAuthorization, setAgentAuthorization] = useState<unknown>(null);
  const [rootDirectory, setRootDirectory] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [saveRequest, setSaveRequest] = useState<SaveAppRequest | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingStatus, setPendingStatus] = useState<
    "building" | "failed" | null
  >(null);
  const [pendingReady, setPendingReady] = useState(false);
  const [visiblePassword, setVisiblePassword] = useState<{
    appName: string;
    password: string;
    appCredential?: { name: string; password: string } | null;
    wasReset?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pendingAppName = pending?.appName;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(runHistoryKey) || "[]") as RunSummary[];
      const valid = Array.isArray(saved)
        ? saved.filter((run) =>
            typeof run.handle === "string" &&
            typeof run.url === "string" &&
            (typeof run.startedAt !== "number" || Date.now() - run.startedAt < 30 * 24 * 60 * 60 * 1_000)
          ).slice(0, 12)
        : [];
      const old = window.sessionStorage.getItem("flyhub:eve-app-task");
      const legacy = old ? JSON.parse(old) as { handle?: string; url?: string } : null;
      if (legacy?.handle && legacy.url && !valid.some((run) => run.handle === legacy.handle))
        valid.unshift({ handle: legacy.handle, url: legacy.url, runId: "", startedAt: null, status: "unknown" });
      window.sessionStorage.removeItem("flyhub:eve-app-task");
      const recent = valid.slice(0, 12);
      setRuns(recent);
      window.localStorage.setItem(runHistoryKey, JSON.stringify(recent));
      if (recent[0]) {
        setAgentHandle(recent[0].handle);
        setUrl(recent[0].url);
      }
      const sharedHandle = new URLSearchParams(window.location.hash.slice(1)).get("run");
      if (sharedHandle && sharedHandle.length <= 4_096) {
        void fetch(`/api/fly-hub/apps/agent?handle=${encodeURIComponent(sharedHandle)}`, { cache: "no-store" })
          .then((response) => json<{ url: string; runId: string; startedAt?: number | null; status: string; mode?: string; progress?: RunProgress; checkedAt?: number }>(response))
          .then((data) => {
            if (typeof data.url !== "string" || !data.url.startsWith("https://github.com/"))
              throw new Error("This setup run has no repository URL.");
            const imported: RunSummary = { handle: sharedHandle, url: data.url, runId: data.runId, startedAt: data.startedAt ?? null, status: data.status, mode: data.mode, progress: data.progress, checkedAt: data.checkedAt };
            setRuns((current) => {
              const next = [imported, ...current.filter((run) => run.handle !== sharedHandle)].slice(0, 12);
              window.localStorage.setItem(runHistoryKey, JSON.stringify(next));
              return next;
            });
            setAgentHandle(sharedHandle);
            setUrl(data.url);
            const cleanUrl = new URL(window.location.href);
            cleanUrl.hash = "";
            window.history.replaceState(window.history.state, "", cleanUrl);
          })
          .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not open this setup run."));
      }
    } catch {
      window.localStorage.removeItem(runHistoryKey);
    }
  }, []);

  useEffect(() => {
    if (!agentHandle) return;
    if (traceCursor.current.handle !== agentHandle) {
      traceCursor.current = { handle: agentHandle, offset: 0 };
      setAgentTrace(null);
    }
    let active = true;
    async function refresh() {
      try {
        const requestedOffset = traceCursor.current.offset;
        const data = await json<{
          status: string;
          mode?: string;
          runId?: string;
          startedAt?: number | null;
          checkedAt?: number;
          progress?: RunProgress;
          trace?: EveTrace | null;
          machines?: RunMachines;
          app?: EveApp;
          result: unknown;
          error?: string | EveFailure | null;
          plan?: EvePlan | null;
          planError?: string | null;
          inputRequests?: Record<string, EveInputRequest> | null;
          authorization?: unknown;
        }>(
          await fetch(
            `/api/fly-hub/apps/agent?handle=${encodeURIComponent(agentHandle!)}&trace=1&traceOffset=${requestedOffset}`,
            { cache: "no-store" },
          ),
        );
        if (!active) return;
        setAgentState(data.status);
        setAgentMode(data.mode ?? null);
        setAgentRunId(data.runId ?? null);
        setAgentStartedAt(data.startedAt ?? null);
        setAgentCheckedAt(data.checkedAt ?? Date.now());
        setAgentProgress(data.progress ?? null);
        if (data.trace && traceCursor.current.handle === agentHandle) {
          traceCursor.current.offset = data.trace.nextOffset;
          setAgentTrace((current) => ({
            ...data.trace!,
            events: [...(requestedOffset ? current?.events ?? [] : []), ...data.trace!.events].slice(-80),
          }));
          if (data.trace.hasMore) window.setTimeout(() => setAgentRefresh((value) => value + 1), 0);
        }
        setAgentMachines(data.machines ?? null);
        setAgentApp(data.app ?? null);
        if (data.result != null) setAgentResult(data.result);
        if (data.plan) setAgentPlan(data.plan);
        if (data.planError) setAgentPlanError(data.planError);
        setAgentInputs(data.inputRequests ?? {});
        setAgentAuthorization(data.authorization ?? null);
        setAgentFailure(data.status === "failed" || data.status === "unavailable"
          ? typeof data.error === "string"
            ? data.error
            : data.error?.message || "Eve status is unavailable."
          : null);
        setAgentFailureDetails(data.error && typeof data.error === "object" ? data.error.data ?? null : null);
        setRuns((current) => {
          const next = current.map((run) => run.handle === agentHandle
            ? {
                ...run,
                runId: data.runId ?? run.runId,
                startedAt: data.startedAt ?? run.startedAt,
                status: data.status,
                mode: data.mode ?? run.mode,
                progress: data.progress,
                checkedAt: data.checkedAt ?? Date.now(),
              }
            : run);
          window.localStorage.setItem(runHistoryKey, JSON.stringify(next));
          return next;
        });
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
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [agentHandle, agentRefresh]);

  useEffect(() => {
    if (!agentHandle || agentState !== "input_required") return;
    const requests = Object.values(agentInputs);
    if (!requests.length || !requests.every((request) =>
      request.kind === "tool-approval" &&
      (request.toolName?.endsWith("flyhub_task_deploy") ||
        request.prompt?.includes("flyhub__flyhub_task_deploy"))
    )) return;
    const key = `${agentHandle}:${requests.map((request) => request.requestId).join(",")}`;
    if (resumedApproval.current === key) return;
    resumedApproval.current = key;
    void fetch("/api/fly-hub/apps/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume_deploy", handle: agentHandle }),
    }).then((response) => json<{ ok: boolean }>(response)).then(() => {
      setAgentState("working");
      setAgentInputs({});
      setAgentRefresh((value) => value + 1);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not continue Eve deployment.");
    });
  }, [agentHandle, agentState, agentInputs]);

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

  async function planWithEve(repository = url, prompt = setupPrompt) {
    setBusy("agent");
    setError("");
    setUrl(repository);
    setAgentHandle(null);
    setAgentRunId(null);
    setAgentStartedAt(null);
    setAgentCheckedAt(null);
    setAgentProgress(null);
    setAgentMachines(null);
    setAgentFailure(null);
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
        runId: string;
        startedAt: number;
        commitSha?: string;
        requiredSecretNames?: string[];
      }>(
        await fetch("/api/fly-hub/apps/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: repository, prompt }),
        }),
      );
      setAgentHandle(result.handle);
      const nextRun: RunSummary = {
        handle: result.handle,
        url: repository,
        prompt,
        runId: result.runId,
        startedAt: result.startedAt,
        status: result.status,
        mode: result.mode,
      };
      setRuns((current) => {
        const next = [nextRun, ...current.filter((run) => run.handle !== result.handle)].slice(0, 12);
        window.localStorage.setItem(runHistoryKey, JSON.stringify(next));
        return next;
      });
      setAgentRunId(result.runId);
      setAgentStartedAt(result.startedAt);
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

  function selectRun(run: RunSummary) {
    setAgentHandle(run.handle);
    setUrl(run.url);
    setSetupPrompt(run.prompt ?? "");
    setAgentState(run.status);
    setAgentMode(run.mode ?? null);
    setAgentRunId(run.runId || null);
    setAgentStartedAt(run.startedAt);
    setAgentProgress(run.progress ?? null);
    setAgentCheckedAt(run.checkedAt ?? null);
    setAgentMachines(null);
    setAgentApp(null);
    setAgentFailure(null);
    setAgentResult(null);
    setAgentInputs({});
    setError("");
    setAgentRefresh((value) => value + 1);
  }

  async function resetPassword(appName: string) {
    setBusy(`reset:${appName}`);
    setError("");
    setVisiblePassword(null);
    try {
      const result = await json<{ password: string }>(
        await fetch(
          `/api/fly-hub/apps/${encodeURIComponent(appName)}/password`,
          { method: "POST" },
        ),
      );
      setVisiblePassword({ appName, password: result.password, wasReset: true });
      setApps((current) => current.map((app) =>
        app.appName === appName ? { ...app, passwordAvailable: true } : app,
      ));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reset password.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function showPassword(appName: string) {
    if (visiblePassword?.appName === appName) {
      setVisiblePassword(null);
      return;
    }
    setBusy(`show:${appName}`);
    setError("");
    try {
      const result = await json<{
        password: string;
        appCredential: { name: string; password: string } | null;
      }>(await fetch(`/api/fly-hub/apps/${encodeURIComponent(appName)}/password`, {
        cache: "no-store",
      }));
      setVisiblePassword({ appName, ...result });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not show password.");
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
      {runs.length > 0 && (
        <section className="rounded-xl border bg-card p-6 space-y-3">
          <h2 className="text-lg font-semibold">Recent setup runs</h2>
          <p className="text-sm text-muted-foreground">Select a run to see its current Eve, build, and machine status. Runs stay here in this browser for up to 30 days.</p>
          <div className="space-y-2">
            {runs.map((run) => (
              <button
                key={run.handle}
                type="button"
                onClick={() => selectRun(run)}
                className={`w-full rounded-md border p-3 text-left text-sm ${agentHandle === run.handle ? "border-primary bg-muted/40" : "bg-background"}`}
              >
                <span className="block font-medium break-all">{run.url}</span>
                <span className="block text-muted-foreground">
                  {run.progress?.stage.replaceAll("_", " ") ?? run.status}
                  {run.startedAt ? ` · ${new Date(run.startedAt).toLocaleString()}` : ""}
                  {run.runId ? ` · ${run.runId}` : ""}
                </span>
                {run.checkedAt && <span className="block text-xs text-muted-foreground">Checked {new Date(run.checkedAt).toLocaleString()}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="rounded-xl border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Deploy from GitHub</h2>
          <p className="text-sm text-muted-foreground">
            Eve inspects, builds, and deploys the repository when you start setup. Follow its progress below.
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
            {busy === "agent" ? "Starting Eve…" : "Set up and deploy"}
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
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{agentMode === "deployment" ? "Run status" : "Eve deployment plan"}</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setAgentRefresh((value) => value + 1)}>Refresh status</Button>
                {agentState && !["completed", "failed", "cancelled"].includes(agentState) && (
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => {
                    setBusy("cancel");
                    void fetch("/api/fly-hub/apps/agent", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "cancel", handle: agentHandle }),
                    }).then((response) => json<{ ok: boolean }>(response)).then(() => setAgentRefresh((value) => value + 1))
                      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not cancel run."))
                      .finally(() => setBusy(null));
                  }}>Cancel run</Button>
                )}
              </div>
            </div>
            {agentRunId && <p><strong>Run ID:</strong> <code className="select-all">{agentRunId}</code></p>}
            <p><a className="underline" href={`/fly/apps#run=${encodeURIComponent(agentHandle)}`}>Link to this run</a> <span className="text-muted-foreground">(requires your Fly sign-in)</span></p>
            {agentStartedAt && <p><strong>Started:</strong> {new Date(agentStartedAt).toLocaleString()}</p>}
            {agentCheckedAt && <p className="text-muted-foreground">Last checked: {new Date(agentCheckedAt).toLocaleString()}</p>}
            {agentProgress && <p role="status"><strong>{agentProgress.stage.replaceAll("_", " ")}:</strong> {agentProgress.explanation}</p>}
            {agentMode === "deployment" && (
              <div className="rounded-md border bg-background p-3 space-y-1">
                <p><strong>Eve:</strong> {agentState ?? "checking"}</p>
                <p><strong>Fly builder:</strong> {agentMachines?.builder
                  ? `${agentMachines.builder.state ?? "unknown"} (${agentMachines.builder.id ?? "unknown ID"})`
                  : "Not created"}</p>
                {agentMachines?.builder?.reason && <p className="text-muted-foreground">{agentMachines.builder.reason}</p>}
                <p><strong>App runtime machine:</strong> {agentMachines?.runtime
                  ? `${agentMachines.runtime.state} (${agentMachines.runtime.id})`
                  : "Not created"}</p>
                {agentMachines?.runtime?.reason && <p className="text-muted-foreground">{agentMachines.runtime.reason}</p>}
                <p><strong>Password gateway machine:</strong> {agentMachines?.gateway
                  ? `${agentMachines.gateway.state} (${agentMachines.gateway.id})`
                  : "Not created"}</p>
                {agentMachines?.gateway?.reason && <p className="text-muted-foreground">{agentMachines.gateway.reason}</p>}
                {agentMachines && <MachineEvents machines={agentMachines} />}
              </div>
            )}
            {agentFailure && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 p-3 text-destructive">{agentFailure}</pre>}
            {agentFailureDetails && (
              <div className="rounded border border-destructive/30 p-3 text-xs space-y-1">
                <strong>Eve error details</strong>
                {agentFailureDetails.name && <p>Cause: {agentFailureDetails.name}</p>}
                {agentFailureDetails.hint && <p>Next step: {agentFailureDetails.hint}</p>}
                {agentFailureDetails.semanticErrorId && <p>Error type: <code>{agentFailureDetails.semanticErrorId}</code></p>}
                {agentFailureDetails.errorId && <p>Error ID: <code className="select-all">{agentFailureDetails.errorId}</code></p>}
                {agentFailureDetails.vercelDeploymentId && <p>Eve deployment: <code className="select-all">{agentFailureDetails.vercelDeploymentId}</code></p>}
              </div>
            )}
            {agentTrace?.events.length ? (
              <details className="rounded border bg-background p-3 text-xs" open={agentState === "failed"}>
                <summary className="cursor-pointer font-semibold">Eve run timeline (through event {agentTrace.nextOffset}{agentTrace.hasMore ? ", loading more…" : ""})</summary>
                <ol className="mt-2 space-y-1">
                  {agentTrace.events.map((event) => <li key={event.index}>
                    <time className="text-muted-foreground">{new Date(event.at).toLocaleTimeString()}</time>{" "}
                    <strong>{event.type.replaceAll(".", " ")}:</strong> {event.summary}
                  </li>)}
                </ol>
              </details>
            ) : null}
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
                {agentMachines?.gateway && (
                  <p>
                    <strong>App:</strong>{" "}
                    <a href={agentApp.url} target="_blank" rel="noopener noreferrer" className="underline">{agentApp.url}</a>
                  </p>
                )}
                {agentApp.buildStatus === "failed" && agentApp.buildError && (
                  <div className="space-y-1 text-destructive">
                    <p className="text-sm font-medium">
                      {agentApp.buildError.trim().split("\n").at(-1)}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-sm">Builder and runtime logs</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {agentApp.buildError}
                      </pre>
                    </details>
                  </div>
                )}
                <p>{agentProgress?.explanation ?? "Checking app status…"}</p>
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
            {agentMode === "deployment" && ["eve_failed", "build_failed", "finished_without_app", "cancelled"].includes(agentProgress?.stage ?? "") && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void planWithEve(url, setupPrompt)}>
                {busy === "agent" ? "Starting…" : "Retry this repository"}
              </Button>
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
            {!app.passwordAvailable && (
              <p className="text-muted-foreground">
                This app was created before password recovery. Reset its password once to make it available here.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  setSaveRequest({ app: app.appName, nonce: Date.now() })
                }
              >
                Save app
              </Button>
              {app.passwordAvailable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void showPassword(app.appName)}
                >
                  {busy === `show:${app.appName}` ? "Loading…" : visiblePassword?.appName === app.appName ? "Hide password" : "Show password"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void resetPassword(app.appName)}
              >
                {busy === `reset:${app.appName}` ? "Resetting…" : "Reset password"}
              </Button>
            </div>
            {visiblePassword?.appName === app.appName && (
              <div role="status" className="space-y-1">
                <p>{visiblePassword.wasReset ? "New Fly Hub password" : "Fly Hub password"}:</p>
                <code className="select-all break-all rounded bg-muted px-2 py-1">
                  {visiblePassword.password}
                </code>
                {visiblePassword.wasReset && <p>Previous Fly Hub passwords and sessions were revoked.</p>}
                {visiblePassword.appCredential && (
                  <p>App login password ({visiblePassword.appCredential.name}):{" "}
                    <code className="select-all break-all rounded bg-muted px-2 py-1">
                      {visiblePassword.appCredential.password}
                    </code>
                  </p>
                )}
                {app.appCredentialName && !visiblePassword.appCredential && (
                  <p className="text-muted-foreground">This app also has its own login. Its password is available in the original setup run.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
      <SavedAppsManager saveRequest={saveRequest} />
    </div>
  );
}
