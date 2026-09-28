"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AppWindow,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";
import { MasterDetailShell } from "./MasterDetailShell";
import { EmptyState } from "./EmptyState";
import { cn } from "../utils";

interface AppRow {
  appId: string;
  kind?: "repository" | "browser" | "brain";
  scope?: "repository" | "personal";
  description?: string;
  manageHref?: string;
  lifecycle?: { start?: string; stop?: string; restart?: string };
  repository?: string;
  name: string;
  slug: string;
  branch?: string;
  rootDirectory?: string;
  observedStatus: string;
  desiredStatus: string;
  provider: { appName?: string; publicUrl?: string };
  exposure?: "private" | "public";
  currentDeploymentId?: string;
  secretNames?: string[];
  accessTokens?: Array<{
    tokenId: string;
    name: string;
    createdAt: string;
    revokedAt?: string;
  }>;
  domains?: Array<{ hostname: string; status: string }>;
  storage?: Array<{
    volumeId: string;
    name: string;
    mountPath: string;
    sizeGb: number;
  }>;
  updatedAt: string;
}
interface Deployment {
  deploymentId: string;
  commitSha: string;
  status: string;
  createdAt: string;
}
const sections = ["Overview", "Activity", "Access", "Settings"] as const;
type AppSection = (typeof sections)[number];

interface AppInspection {
  repository: string;
  ref: string;
  commitSha: string;
  name: string;
  slug: string;
  plan: {
    kind: string;
    rootDirectory: string;
    questions?: string[];
    [key: string]: unknown;
  };
  requiredSecretNames?: string[];
}
async function api(
  path: string,
  headers: Record<string, string>,
  init: RequestInit = {},
) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function appsSearchStorageKey() {
  const appsPath = window.location.pathname.match(/^(.*?\/apps)(?:\/|$)/)?.[1];
  return `kody:apps-search:${appsPath ?? "/apps"}`;
}

export function AppsManager() {
  const { auth, loading: authLoading } = useAuth(),
    router = useRouter(),
    pathname = usePathname(),
    scopedHref = useRepoScopedHref();
  const initialSlugMatch = pathname.match(/\/apps\/([^/]+)\/?$/);
  const [search, setSearch] = useState(""),
    [selectedSlug, setSelectedSlug] = useState(
      initialSlugMatch ? decodeURIComponent(initialSlugMatch[1]) : undefined,
    ),
    [createOpen, setCreateOpen] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const appsQuery = useQuery({
    queryKey: ["apps", auth?.owner, auth?.repo],
    enabled: !authLoading && Boolean(auth),
    staleTime: Infinity,
    queryFn: async () => {
      const body = await api("/api/kody/apps", headers);
      return (body.apps ?? []) as AppRow[];
    },
  });
  const apps = appsQuery.data ?? [];
  const loading = appsQuery.isLoading;
  const error = appsQuery.error
    ? appsQuery.error instanceof Error
      ? appsQuery.error.message
      : "Apps unavailable"
    : undefined;
  const load = useCallback(async () => {
    await appsQuery.refetch();
  }, [appsQuery]);
  const refreshApps = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  useEffect(() => {
    setSearch(window.sessionStorage.getItem(appsSearchStorageKey()) ?? "");
  }, []);
  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    window.sessionStorage.setItem(appsSearchStorageKey(), value);
  }, []);
  useEffect(() => {
    const syncSelection = () => {
      const match = window.location.pathname.match(/\/apps\/([^/]+)\/?$/);
      setSelectedSlug(match ? decodeURIComponent(match[1]) : undefined);
    };
    window.addEventListener("popstate", syncSelection);
    return () => window.removeEventListener("popstate", syncSelection);
  }, []);
  const selectApp = useCallback(
    (slug?: string, replace = false) => {
      const href = scopedHref(slug ? `/apps/${slug}` : "/apps");
      const updateHistory = replace
        ? window.History.prototype.replaceState
        : window.History.prototype.pushState;
      updateHistory.call(window.history, null, "", href);
      setSelectedSlug(slug);
    },
    [scopedHref],
  );
  const selected = apps.find((app) => app.slug === selectedSlug),
    filtered = apps.filter((app) =>
      `${app.name} ${app.slug} ${app.repository ?? ""} ${app.branch ?? ""} ${app.observedStatus}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("kody:set-chat-scope", {
        detail: selected
          ? {
              kind: "app",
              app: {
                slug: selected.slug,
                repository: selected.repository,
                name: selected.name,
                status: selected.observedStatus,
                branch: selected.branch,
                rootDirectory: selected.rootDirectory,
                exposure: selected.exposure,
                currentDeploymentId: selected.currentDeploymentId,
                secretNames: selected.secretNames ?? [],
                domains: selected.domains ?? [],
                storage: selected.storage ?? [],
              },
            }
          : null,
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("kody:set-chat-scope", { detail: null }),
      );
    };
  }, [selected]);
  return (
    <>
      <MasterDetailShell
        title="Apps"
        icon={AppWindow}
        subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
        search={search}
        onSearch={updateSearch}
        searchPlaceholder="Search apps..."
        searchAriaLabel="Search apps"
        accent="teal"
        hasSelection={Boolean(selected)}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Refresh apps"
              disabled={refreshing}
              onClick={() => void refreshApps()}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Deploy app
            </Button>
          </div>
        }
        detail={
          selected ? (
            <AppDetail
              key={selected.appId}
              app={selected}
              headers={headers}
              refresh={load}
              scopedHref={scopedHref}
              onOpenManaged={(href) => router.push(scopedHref(href))}
              onDeleted={() => selectApp(undefined, true)}
            />
          ) : (
            <EmptyState
              icon={<AppWindow />}
              title="Select an app"
              hint="Choose an app to manage it."
            />
          )
        }
      >
        {loading ? (
          <EmptyState
            icon={<Loader2 className="animate-spin" />}
            title="Loading apps..."
          />
        ) : error ? (
          <EmptyState
            icon={<AppWindow />}
            title="Could not load apps"
            hint={error}
            action={<Button onClick={load}>Retry</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<AppWindow />}
            title="No apps found"
            hint={search ? "Try a different search." : "Deploy your first app."}
            action={
              search ? undefined : (
                <Button onClick={() => setCreateOpen(true)}>Deploy app</Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((app) => (
              <li key={app.appId}>
                <button
                  className={cn(
                    "w-full px-4 py-3 text-left hover:bg-accent/50",
                    selected?.appId === app.appId && "bg-accent/70",
                  )}
                  onClick={() => selectApp(app.slug)}
                >
                  <div className="flex justify-between gap-3">
                    <span className="truncate font-medium">{app.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {app.observedStatus}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {app.scope === "personal"
                      ? "Personal"
                      : (app.repository ?? `${auth?.owner}/${auth?.repo}`)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>
      {auth ? (
        <CreateAppDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          owner={auth.owner}
          repo={auth.repo}
          headers={headers}
          onCreated={async (slug) => {
            await load();
            setCreateOpen(false);
            selectApp(slug);
          }}
        />
      ) : null}
    </>
  );
}

function CreateAppDialog({
  open,
  onOpenChange,
  owner,
  repo,
  headers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  headers: Record<string, string>;
  onCreated: (slug: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState(`${owner}/${repo}`);
  const [rootDirectory, setRootDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const create = async () => {
    if (!name.trim()) {
      setError("Enter an app name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const inspection = (await api("/api/kody/apps/inspect", headers, {
        method: "POST",
        body: JSON.stringify({
          repository,
          rootDirectory: rootDirectory.trim() || ".",
          name: name.trim(),
        }),
      })) as AppInspection;
      if (
        inspection.plan.kind === "unsupported" ||
        inspection.plan.questions?.length
      ) {
        throw new Error(
          inspection.plan.questions?.[0] ?? "This app needs more setup.",
        );
      }
      const result = await api("/api/kody/apps", headers, {
        method: "POST",
        body: JSON.stringify({
          repository: inspection.repository,
          name: inspection.name,
          slug: inspection.slug,
          ref: inspection.ref,
          commitSha: inspection.commitSha,
          plan: inspection.plan,
          secretNames: inspection.requiredSecretNames ?? [],
          requestId: crypto.randomUUID(),
        }),
      });
      await onCreated(result.slug ?? inspection.slug);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create app");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Deploy repository app" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Deploy repository app</DialogTitle>
          <DialogDescription>
            Run code from a repository as a hosted service. Kody handles its Fly
            setup and starts it when opened.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            App name
            <Input
              className="mt-1"
              aria-label="App name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My app"
            />
          </label>
          <label className="block text-sm">
            Repository
            <Input
              className="mt-1"
              aria-label="Repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Folder containing the app (optional)
            <Input
              className="mt-1"
              aria-label="Folder containing the app (optional)"
              value={rootDirectory}
              onChange={(event) => setRootDirectory(event.target.value)}
              placeholder="apps/web"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Leave empty if the app uses the whole repository. Example:
              apps/web
            </span>
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Deploy app
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppDetail({
  app,
  headers,
  refresh,
  scopedHref,
  onDeleted,
  onOpenManaged,
}: {
  app: AppRow;
  headers: Record<string, string>;
  refresh: () => Promise<void>;
  scopedHref: (path: string) => string;
  onDeleted: () => void;
  onOpenManaged: (href: string) => void;
}) {
  const managed = Boolean(app.kind && app.kind !== "repository");
  const hasLifecycleActions =
    !managed || Boolean(app.lifecycle?.start || app.lifecycle?.stop);
  const [section, setSection] = useState<AppSection>("Overview"),
    [busy, setBusy] = useState<string>(),
    [message, setMessage] = useState<string>(),
    [visibleStatus, setVisibleStatus] = useState(app.observedStatus),
    [deployments, setDeployments] = useState<Deployment[]>([]),
    [logs, setLogs] = useState<unknown>(),
    [createdToken, setCreatedToken] = useState<string>();
  useEffect(() => setVisibleStatus(app.observedStatus), [app.observedStatus]);
  const act = async (path: string, body: unknown, label: string) => {
    setBusy(label);
    setMessage(undefined);
    if (["Start", "Stop", "Restart"].includes(label))
      setVisibleStatus(
        label === "Start"
          ? "starting"
          : label === "Stop"
            ? "stopping"
            : "restarting",
      );
    try {
      const result = await api(path, headers, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (typeof result.status === "string") setVisibleStatus(result.status);
      setMessage(`${label} completed.`);
      await refresh();
      return result;
    } catch (error) {
      setVisibleStatus(app.observedStatus);
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(undefined);
    }
  };
  const startApp = async (): Promise<boolean> => {
    setBusy("Start");
    setMessage(undefined);
    setVisibleStatus("starting");
    try {
      const result = await api(
        app.lifecycle?.start ?? `/api/kody/apps/${app.slug}/actions`,
        headers,
        {
          method: "POST",
          body: JSON.stringify(app.lifecycle?.start ? {} : { action: "start" }),
        },
      );
      setVisibleStatus(result.status ?? "running");
      setMessage(
        result.repairing
          ? "The Fly app was missing. Rebuild started automatically."
          : "Start completed.",
      );
      await refresh();
      return true;
    } catch (error) {
      setVisibleStatus(app.observedStatus);
      setMessage(error instanceof Error ? error.message : "Start failed");
      return false;
    } finally {
      setBusy(undefined);
    }
  };
  const openApp = async () => {
    if (app.manageHref) {
      setBusy("Open");
      setMessage("Opening app…");
      try {
        if (app.lifecycle?.start && visibleStatus !== "running")
          await api(app.lifecycle.start, headers, {
            method: "POST",
            body: JSON.stringify({}),
          });
        onOpenManaged(app.manageHref);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not open app",
        );
      } finally {
        setBusy(undefined);
      }
      return;
    }
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    setBusy("Open");
    setMessage(visibleStatus === "running" ? "Opening app…" : "Starting app…");
    try {
      if (visibleStatus !== "running") {
        const started = await startApp();
        if (!started) {
          target?.close();
          return;
        }
        setBusy("Open");
      }
      const result = await api(`/api/kody/apps/${app.slug}/open`, headers, {
        method: "POST",
      });
      if (target) target.location.replace(result.url);
      else window.location.assign(result.url);
      setMessage("App opened in a signed-in tab.");
    } catch (error) {
      target?.close();
      setMessage(error instanceof Error ? error.message : "Could not open app");
    } finally {
      setBusy(undefined);
    }
  };
  useEffect(() => {
    if (section !== "Activity" || managed) return;
    void Promise.all([
      api(`/api/kody/apps/${app.slug}/deployments`, headers).then((body) =>
        setDeployments(body.deployments ?? []),
      ),
      api(`/api/kody/apps/${app.slug}/logs`, headers).then(setLogs),
    ]).catch((error) => setMessage(error.message));
  }, [section, app.slug, headers, managed]);
  return (
    <div className="min-h-full">
      <header className="border-b p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{app.name}</h2>
            <AppStatus
              status={visibleStatus}
              branch={
                managed
                  ? app.scope === "personal"
                    ? "Personal app"
                    : "Repository app"
                  : (app.branch ?? "")
              }
              exposure={app.exposure}
            />
          </div>
          <div className="flex items-center gap-2">
            {!managed && app.provider.appName ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  aria-label="View machines"
                  href={scopedHref(`/fly/machines/${app.provider.appName}`)}
                >
                  <Server className="mr-2 h-4 w-4" />
                  Machines
                </a>
              </Button>
            ) : null}
            {app.provider.publicUrl || app.manageHref ? (
              <Button
                aria-label="Open app"
                className="bg-cyan-600 text-white hover:bg-cyan-500"
                disabled={Boolean(busy)}
                onClick={openApp}
              >
                {busy === "Open" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                Open
              </Button>
            ) : null}
            {hasLifecycleActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="App actions"
                    disabled={Boolean(busy)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(!managed || app.lifecycle?.start) && (
                    <DropdownMenuItem
                      disabled={visibleStatus === "running"}
                      onSelect={() => void startApp()}
                    >
                      <Play /> Start app
                    </DropdownMenuItem>
                  )}
                  {(!managed || app.lifecycle?.stop) && (
                    <DropdownMenuItem
                      disabled={visibleStatus === "stopped"}
                      onSelect={() =>
                        void act(
                          app.lifecycle?.stop ??
                            `/api/kody/apps/${app.slug}/actions`,
                          app.lifecycle?.stop ? {} : { action: "stop" },
                          "Stop",
                        )
                      }
                    >
                      <Square /> Stop app
                    </DropdownMenuItem>
                  )}
                  {!managed && (
                    <DropdownMenuItem
                      disabled={visibleStatus !== "running"}
                      onSelect={() =>
                        void act(
                          `/api/kody/apps/${app.slug}/actions`,
                          { action: "restart" },
                          "Restart",
                        )
                      }
                    >
                      <RotateCw /> Restart app
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1">
          {sections.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={section === item ? "default" : "ghost"}
              onClick={() => setSection(item)}
            >
              {item}
            </Button>
          ))}
        </nav>
      </header>
      {message ? (
        <p
          role="status"
          className="border-b px-5 py-2 text-sm text-muted-foreground"
        >
          {message}
        </p>
      ) : null}
      <section className="p-5">
        {section === "Overview" ? (
          <Overview
            app={app}
            visibleStatus={visibleStatus}
            volumesHref={scopedHref("/fly/volumes")}
          />
        ) : section === "Activity" ? (
          managed ? (
            <ManagedActivity app={app} />
          ) : (
            <RepositoryActivity
              app={app}
              rows={deployments}
              logs={logs}
              act={act}
            />
          )
        ) : section === "Access" ? (
          managed ? (
            <ManagedAccess />
          ) : (
            <RepositoryAccess
              app={app}
              headers={headers}
              refresh={refresh}
              busy={busy}
              createdToken={createdToken}
              setCreatedToken={setCreatedToken}
              act={act}
              setMessage={setMessage}
            />
          )
        ) : managed ? (
          <ManagedSettings app={app} />
        ) : (
          <RepositorySettings
            app={app}
            headers={headers}
            refresh={refresh}
            busy={busy}
            act={act}
            onDeleted={onDeleted}
            setMessage={setMessage}
            secretsHref={scopedHref("/secrets")}
            volumesHref={scopedHref("/fly/volumes")}
          />
        )}
      </section>
    </div>
  );
}

function ManagedActivity({ app }: { app: AppRow }) {
  return (
    <div className="max-w-2xl space-y-2 text-sm">
      <h3 className="font-medium">Current activity</h3>
      <p className="text-muted-foreground">
        {app.observedStatus === "running"
          ? "The app is ready to use."
          : `The app is ${app.observedStatus}. Open it to start or resume it.`}
      </p>
      <p className="text-xs text-muted-foreground">
        Updated {new Date(app.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}

function ManagedSettings({ app }: { app: AppRow }) {
  return (
    <div className="max-w-2xl space-y-3 text-sm">
      <h3 className="font-medium">App settings</h3>
      <p className="text-muted-foreground">
        Kody manages this app automatically. Its settings are available inside
        the app.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Info
          label="Scope"
          value={app.scope === "personal" ? "Personal" : "Repository"}
        />
        <Info
          label="Address"
          value={app.provider.publicUrl ?? "Managed by Kody"}
        />
      </dl>
    </div>
  );
}

function ManagedAccess() {
  return (
    <div className="max-w-2xl space-y-2 text-sm">
      <h3 className="font-medium">Access</h3>
      <p className="text-muted-foreground">
        Kody opens this app using your signed-in account. No consumer token
        setup is required.
      </p>
    </div>
  );
}

function RepositoryActivity({
  app,
  rows,
  logs,
  act,
}: {
  app: AppRow;
  rows: Deployment[];
  logs: unknown;
  act: (path: string, body: unknown, label: string) => Promise<unknown>;
}) {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h3 className="mb-3 font-medium">Deployments</h3>
        {rows.length ? (
          <Deployments app={app} rows={rows} act={act} />
        ) : (
          <p className="text-sm text-muted-foreground">No deployments yet.</p>
        )}
      </div>
      <div>
        <h3 className="mb-3 font-medium">Logs</h3>
        <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border bg-black/30 p-3 text-xs">
          {logs ? JSON.stringify(logs, null, 2) : "No logs yet."}
        </pre>
      </div>
    </div>
  );
}

function RepositorySettings({
  app,
  headers,
  refresh,
  busy,
  act,
  onDeleted,
  setMessage,
  secretsHref,
  volumesHref,
}: {
  app: AppRow;
  headers: Record<string, string>;
  refresh: () => Promise<void>;
  busy?: string;
  act: (path: string, body: unknown, label: string) => Promise<unknown>;
  onDeleted: () => void;
  setMessage: (message: string) => void;
  secretsHref: string;
  volumesHref: string;
}) {
  return (
    <div className="max-w-3xl space-y-10">
      <section>
        <h3 className="mb-3 font-medium">General</h3>
        <Settings
          app={app}
          headers={headers}
          refresh={refresh}
          setMessage={setMessage}
        />
      </section>
      <section className="border-t pt-6">
        <Environment
          app={app}
          busy={busy}
          secretsHref={secretsHref}
          saveEnvironment={(names) =>
            void act(
              `/api/kody/apps/${app.slug}/environment`,
              { secretNames: names },
              "Update environment",
            )
          }
        />
      </section>
      <section className="border-t pt-6">
        <Danger
          app={app}
          headers={headers}
          onDeleted={onDeleted}
          setMessage={setMessage}
          volumesHref={volumesHref}
        />
      </section>
    </div>
  );
}

function AppStatus({
  status,
  branch,
  exposure,
}: {
  status: string;
  branch: string;
  exposure?: AppRow["exposure"];
}) {
  const states: Record<
    string,
    { label: string; detail: string; className: string }
  > = {
    running: {
      label: "Running",
      detail: "ready to open",
      className: "bg-emerald-500/15 text-emerald-400",
    },
    stopped: {
      label: "Stopped",
      detail: "not serving traffic",
      className: "bg-muted text-muted-foreground",
    },
    starting: {
      label: "Starting app…",
      detail: "waiting for the Machine",
      className: "bg-amber-500/15 text-amber-400",
    },
    stopping: {
      label: "Stopping app…",
      detail: "shutting down safely",
      className: "bg-amber-500/15 text-amber-400",
    },
    restarting: {
      label: "Restarting app…",
      detail: "waiting for the Machine",
      className: "bg-amber-500/15 text-amber-400",
    },
    provisioning: {
      label: "Setting up",
      detail: "creating the app",
      className: "bg-cyan-500/15 text-cyan-400",
    },
    deploying: {
      label: "Deploying",
      detail: "building the app",
      className: "bg-cyan-500/15 text-cyan-400",
    },
    verifying: {
      label: "Verifying",
      detail: "checking the app works",
      className: "bg-cyan-500/15 text-cyan-400",
    },
    unhealthy: {
      label: "Needs attention",
      detail: "health check failed",
      className: "bg-destructive/15 text-destructive",
    },
    failed: {
      label: "Failed",
      detail: "open logs for details",
      className: "bg-destructive/15 text-destructive",
    },
  };
  const state = states[status] ?? {
    label: status,
    detail: "status reported by Fly",
    className: "bg-muted text-muted-foreground",
  };
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
      <span
        className={cn("rounded-full px-2 py-0.5 font-medium", state.className)}
      >
        {state.label} — {state.detail}
      </span>
      <span className="text-muted-foreground">
        {branch}
        {exposure ? ` · ${exposure}` : ""}
      </span>
    </p>
  );
}
function Overview({
  app,
  visibleStatus,
  volumesHref,
}: {
  app: AppRow;
  visibleStatus: string;
  volumesHref: string;
}) {
  return (
    <dl className="grid max-w-2xl gap-3 text-sm sm:grid-cols-2">
      <Info label="Status" value={visibleStatus} />
      <Info label="Desired" value={app.desiredStatus} />
      {app.kind && app.kind !== "repository" ? (
        <>
          <Info label="Type" value={app.name} />
          <Info
            label="Scope"
            value={app.scope === "personal" ? "Personal app" : "Repository app"}
          />
        </>
      ) : (
        <>
          <Info
            label="Source"
            value={`${app.repository}@${app.branch}:${app.rootDirectory}`}
          />
          <Info
            label="Access"
            value={
              app.exposure === "private" ? "Consumer token required" : "Public"
            }
          />
        </>
      )}
      <Info label="URL" value={app.provider.publicUrl ?? "Not ready"} />
      <Info label="Updated" value={new Date(app.updatedAt).toLocaleString()} />
      {(app.storage?.length ?? 0) > 0 ? (
        <div className="rounded border p-3">
          <dt className="text-xs text-muted-foreground">Persistent storage</dt>
          <dd className="mt-1">
            {app.storage!.length} volume{app.storage!.length === 1 ? "" : "s"}{" "}
            connected
          </dd>
          <a
            className="mt-2 inline-block text-sm text-cyan-400 hover:underline"
            href={volumesHref}
            aria-label="View Fly volumes"
          >
            View Fly volumes
          </a>
        </div>
      ) : null}
    </dl>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all">{value}</dd>
    </div>
  );
}
function Deployments({
  app,
  rows,
  act,
}: {
  app: AppRow;
  rows: Deployment[];
  act: (p: string, b: unknown, l: string) => Promise<unknown>;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.deploymentId}
          className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
        >
          <div>
            <p className="font-mono text-xs">{row.commitSha.slice(0, 12)}</p>
            <p className="text-xs text-muted-foreground">
              {row.status} · {new Date(row.createdAt).toLocaleString()}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={row.status !== "running"}
            onClick={() =>
              act(
                `/api/kody/apps/${app.slug}/deployments`,
                {
                  requestId: crypto.randomUUID(),
                  rollbackDeploymentId: row.deploymentId,
                },
                "Rollback",
              )
            }
          >
            Rollback
          </Button>
        </div>
      ))}
    </div>
  );
}
function Environment({
  app,
  saveEnvironment,
  busy,
  secretsHref,
}: {
  app: AppRow;
  saveEnvironment: (names: string[]) => void;
  busy?: string;
  secretsHref: string;
}) {
  const [secretNames, setSecretNames] = useState(
    (app.secretNames ?? []).join(", "),
  );
  return (
    <div className="max-w-2xl space-y-3">
      <h3 className="font-medium">Runtime secret names</h3>
      <p className="text-xs text-muted-foreground">
        The app receives selected secrets. Their values stay on the repository
        Secrets page.
      </p>
      <div className="flex gap-2">
        <Input
          value={secretNames}
          onChange={(event) => setSecretNames(event.target.value)}
          placeholder="DATABASE_URL, API_KEY"
          aria-label="Runtime secret names"
        />
        <Button
          disabled={Boolean(busy)}
          onClick={() =>
            saveEnvironment(
              secretNames
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            )
          }
        >
          Save & restart
        </Button>
      </div>
      <a
        className="inline-block text-sm text-cyan-400 hover:underline"
        href={secretsHref}
      >
        Manage repository secrets
      </a>
    </div>
  );
}

function RepositoryAccess({
  app,
  headers,
  refresh,
  busy,
  createdToken,
  setCreatedToken,
  act,
  setMessage,
}: {
  app: AppRow;
  headers: Record<string, string>;
  refresh: () => Promise<void>;
  busy?: string;
  createdToken?: string;
  setCreatedToken: (token?: string) => void;
  act: (path: string, body: unknown, label: string) => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [name, setName] = useState("Consumer");
  const [exposure, setExposure] = useState(app.exposure ?? "private");
  const saveAccess = async () => {
    try {
      await api(`/api/kody/apps/${app.slug}`, headers, {
        method: "PATCH",
        body: JSON.stringify({ exposure }),
      });
      setMessage("Access saved; controlled redeploy started.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  };
  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-3">
        <h3 className="font-medium">Who can open this app</h3>
        <select
          className="block w-full rounded border bg-background p-2 text-sm"
          value={exposure}
          aria-label="App access"
          onChange={(event) =>
            setExposure(event.target.value as "private" | "public")
          }
        >
          <option value="private">Private — Kody sign-in required</option>
          <option value="public">Public</option>
        </select>
        <Button disabled={Boolean(busy)} onClick={() => void saveAccess()}>
          Save access
        </Button>
      </section>
      <section className="space-y-3 border-t pt-6">
        <h3 className="font-medium">Consumer access tokens</h3>
        <p className="text-xs text-muted-foreground">
          Create a token only when an external client needs to call this app.
        </p>
        {createdToken ? (
          <div className="rounded border border-amber-500/40 p-3">
            <p className="text-xs text-amber-300">
              Copy now. This token will not be shown again.
            </p>
            <code className="mt-2 block break-all text-xs">{createdToken}</code>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Token name"
          />
          <Button
            disabled={Boolean(busy)}
            onClick={async () => {
              const result = (await act(
                `/api/kody/apps/${app.slug}/tokens`,
                { action: "create", name },
                "Create token",
              )) as { accessToken?: string } | undefined;
              if (result?.accessToken) setCreatedToken(result.accessToken);
            }}
          >
            Create token
          </Button>
        </div>
        {(app.accessTokens ?? []).map((token) => (
          <div
            key={token.tokenId}
            className="flex items-center justify-between border-t py-2 text-sm"
          >
            <span>
              {token.name}
              {token.revokedAt ? " · revoked" : ""}
            </span>
            {!token.revokedAt ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void act(
                    `/api/kody/apps/${app.slug}/tokens`,
                    { action: "revoke", tokenId: token.tokenId },
                    "Revoke token",
                  )
                }
              >
                Revoke
              </Button>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
function Settings({
  app,
  headers,
  refresh,
  setMessage,
}: {
  app: AppRow;
  headers: Record<string, string>;
  refresh: () => Promise<void>;
  setMessage: (v: string) => void;
}) {
  const [name, setName] = useState(app.name),
    [branch, setBranch] = useState(app.branch);
  return (
    <div className="max-w-xl space-y-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="App name"
      />
      <Input
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        aria-label="Branch"
      />
      <Button
        onClick={async () => {
          try {
            await api(`/api/kody/apps/${app.slug}`, headers, {
              method: "PATCH",
              body: JSON.stringify({ name, branch }),
            });
            setMessage("Settings saved.");
            await refresh();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Save failed");
          }
        }}
      >
        Save settings
      </Button>
    </div>
  );
}
function Danger({
  app,
  headers,
  onDeleted,
  setMessage,
  volumesHref,
}: {
  app: AppRow;
  headers: Record<string, string>;
  onDeleted: () => void;
  setMessage: (v: string) => void;
  volumesHref: string;
}) {
  const hasStorage = Boolean(app.storage?.length);
  return (
    <div className="max-w-xl rounded border border-destructive/40 p-4">
      <h3 className="font-medium text-destructive">Delete App</h3>
      <p className="my-3 text-sm text-muted-foreground">
        {hasStorage
          ? "Handle the app's persistent volumes in Fly Volumes before deleting it."
          : "Deletes the Fly app and its machines."}
      </p>
      {hasStorage ? (
        <a
          className="mb-3 block text-sm text-cyan-400 hover:underline"
          href={volumesHref}
        >
          View Fly volumes
        </a>
      ) : null}
      <Button
        variant="destructive"
        disabled={hasStorage}
        onClick={async () => {
          if (!window.confirm(`Delete ${app.name}?`)) return;
          try {
            await api(`/api/kody/apps/${app.slug}`, headers, {
              method: "DELETE",
              body: JSON.stringify({ deleteStorage: false }),
            });
            onDeleted();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Delete failed",
            );
          }
        }}
      >
        <Trash2 className="mr-1 h-4 w-4" />
        Delete App
      </Button>
    </div>
  );
}
