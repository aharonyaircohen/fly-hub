/**
 * @fileType component
 * @domain preview
 * @pattern preview-workspace
 * @ai-summary Standalone `/preview` page — the full Vibe preview (iframe, Web/
 *   Admin views, device sizes, element inspector → chat) detached from any task.
 *   Adds a named-environment switcher (Production / Staging / Dev …) whose list
 *   lives in backend `dashboard.json`. The shared chat rail provides the composer
 *   the inspector injects into, so element-pick + screenshot work here too.
 *   The shell renders the page header above this; we just fill the pane.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Octokit } from "@octokit/rest";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe2, Loader2, MonitorPlay, Upload } from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { useChatScope } from "@dashboard/lib/components/ChatRailShell";
import { useGitHubIdentity } from "@dashboard/lib/hooks/useGitHubIdentity";
import { useRepoScopedHref } from "@dashboard/lib/hooks/useRepoScopedHref";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { PreviewPane } from "@dashboard/features/previews/components/PreviewPane";
import { PreviewEnvSwitcher } from "@dashboard/features/previews/components/PreviewEnvSwitcher";
import { PreviewBranchEnvForm } from "@dashboard/features/previews/components/PreviewBranchEnvForm";
import { PreviewFileUploadButton } from "@dashboard/features/previews/components/PreviewFileUploadButton";
import {
  addBranchPreviewEnvironment,
  addEnvironment,
  addRepoViewEnvironment,
  expiredUploads,
  isFlyBranchEnvironment,
  makeEnvId,
  normalizeBranchName,
  normalizeEnvUrl,
  repoViewIdFromPath,
  resolveEnvironments,
  resolvePreviewFolders,
  setEnvExpiry,
  STATIC_PREVIEW_TTL_MS,
  type PreviewEnvironment,
  type PreviewEnvironmentFolder,
} from "@kody-ade/fly/preview-environments";
import {
  BRANCH_PREVIEW_POLL_MS,
  branchPreviewNeedsPoll,
  fetchBranchPreviews,
} from "@dashboard/lib/previews/branch-preview-client";
import { destroyStaticPreview } from "@dashboard/lib/previews/static-preview-client";
import {
  deleteRepoView,
  mintRepoViewTicket,
  tokenizeRepoViewUrl,
  uploadRepoView,
} from "@dashboard/lib/previews/repo-view-client";
import { createUploadContext } from "@kody-ade/fly/previews/upload-context";
import {
  fetchDashboardConfig,
  saveDashboardConfig,
} from "@dashboard/lib/dashboard-config/client";
import { previewChatContextBlock } from "@dashboard/lib/previews/chat-context";
import {
  getStoredAuth,
  RateLimitError,
  NoTokenError,
  SessionExpiredError,
} from "@dashboard/lib/api";
import { REPO_VIEW_SANDBOX } from "@dashboard/lib/html-preview-security";
import {
  base64ToBytes,
  readFile,
} from "@dashboard/features/file-manager/lib/repo-files";
import {
  browserUploadMimeType,
  type RemoteBrowserActionResult,
} from "@dashboard/lib/previews/browser-session-client";

function selectionKey(owner: string, repo: string): string {
  return `kody.previewEnv.${owner}/${repo}`;
}

function repoViewUrlLooksLikePdf(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://kody.local");
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}

function isTransientRepoViewUrl(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined"
        ? "http://kody.local"
        : window.location.origin,
    );
    return parsed.pathname.startsWith("/api/kody/views/_t/");
  } catch {
    return url.startsWith("/api/kody/views/_t/");
  }
}

function labelFromPreviewUrl(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined"
        ? "http://kody.local"
        : window.location.origin,
    );
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return host || "Saved URL";
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const suffix = last.replace(/[-_]+/g, " ").trim();
    return suffix ? `${host} ${suffix}` : host || "Saved URL";
  } catch {
    return "Saved URL";
  }
}

function uniqueEnvironmentLabel(
  environments: PreviewEnvironment[],
  preferred: string,
): string {
  const usedIds = new Set(environments.map((environment) => environment.id));
  const usedLabels = new Set(
    environments.map((environment) => environment.label.trim().toLowerCase()),
  );
  const isUsed = (label: string): boolean =>
    usedIds.has(makeEnvId(label)) || usedLabels.has(label.trim().toLowerCase());
  if (!isUsed(preferred)) {
    return preferred;
  }
  let suffix = 2;
  while (isUsed(`${preferred} ${suffix}`)) {
    suffix += 1;
  }
  return `${preferred} ${suffix}`;
}

export function PreviewWorkspace({
  selectedId = null,
}: {
  selectedId?: string | null;
} = {}) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const queryClient = useQueryClient();
  const { githubUser } = useGitHubIdentity();
  const {
    setComposerInjection,
    setAttachmentInjection,
    setPreviewContext,
    setPreviewActionRunner,
  } = useChatScope();
  const owner = getStoredAuth()?.owner ?? "";
  const repo = getStoredAuth()?.repo ?? "";
  const repoFullName = owner && repo ? `${owner}/${repo}` : "";
  const resolveBrowserUploadFiles = useCallback(
    async (paths: string[]) => {
      const auth = getStoredAuth();
      if (!auth?.token || !owner || !repo) {
        throw new Error("browser_upload_repository_unavailable");
      }
      const octokit = new Octokit({ auth: auth.token });
      return Promise.all(
        paths.map(async (path) => {
          const file = await readFile(octokit, owner, repo, path);
          const name = path.split("/").pop() ?? "media";
          const mimeType = browserUploadMimeType(name);
          if (!file || !mimeType) {
            throw new Error("browser_upload_file_not_supported");
          }
          return {
            name,
            mimeType,
            bytes: base64ToBytes(file.base64Content),
          };
        }),
      );
    },
    [owner, repo],
  );

  const configQuery = useQuery({
    queryKey: ["kody-dashboard-config"],
    queryFn: fetchDashboardConfig,
    enabled: !!getStoredAuth(),
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => {
      if (err instanceof RateLimitError) return false;
      if (err instanceof NoTokenError) return false;
      if (err instanceof SessionExpiredError) return false;
      return count < 2;
    },
  });

  const environments = useMemo(
    () => resolveEnvironments(configQuery.data?.config),
    [configQuery.data],
  );
  const previewFolders = useMemo(
    () => resolvePreviewFolders(configQuery.data?.config.previewFolders),
    [configQuery.data],
  );
  const configLoaded = configQuery.data !== undefined;

  // Remember the last-picked environment per repo so /preview restores it.
  const [storedId, setStoredId] = useState<string | null>(null);
  const selectionScope = owner && repo ? selectionKey(owner, repo) : "";
  const [loadedSelectionScope, setLoadedSelectionScope] = useState<
    string | null
  >(null);
  const [websiteName, setWebsiteName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const pendingSelectionRef = useRef<string | null>(null);
  const [environmentSelection, setEnvironmentSelection] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  useEffect(() => {
    setStoredId(null);
    if (!selectionScope) {
      setLoadedSelectionScope("");
      return;
    }
    try {
      const stored = window.localStorage.getItem(selectionScope);
      if (stored) setStoredId(stored);
    } catch {
      /* private mode — ignore */
    } finally {
      setLoadedSelectionScope(selectionScope);
    }
  }, [selectionScope]);

  // Keep selection valid: default to the stored env or first env when none
  // chosen, or when the chosen one was removed.
  useEffect(() => {
    if (configQuery.isLoading || !configLoaded) return;
    if (loadedSelectionScope !== selectionScope) return;
    if (environments.length === 0) {
      if (selectedId) router.replace(scopedHref("/preview"));
      return;
    }
    const pendingSelectedId = pendingSelectionRef.current;
    if (pendingSelectedId) {
      const pendingExists = environments.some(
        (e) => e.id === pendingSelectedId,
      );
      if (pendingExists && selectedId !== pendingSelectedId) {
        router.replace(
          scopedHref(selectionPath("/preview", pendingSelectedId)),
        );
        return;
      }
      if (!pendingExists && selectedId !== pendingSelectedId) {
        return;
      }
    }
    if (selectedId && environments.some((e) => e.id === selectedId)) {
      if (pendingSelectedId === selectedId) {
        pendingSelectionRef.current = null;
      }
      try {
        window.localStorage.setItem(selectionKey(owner, repo), selectedId);
      } catch {
        /* ignore */
      }
      return;
    }
    if (selectedId && pendingSelectedId === selectedId) {
      return;
    }
    const fallback =
      environments.find((env) => env.id === storedId) ?? environments[0]!;
    router.replace(scopedHref(selectionPath("/preview", fallback.id)));
  }, [
    configLoaded,
    configQuery.isLoading,
    environments,
    loadedSelectionScope,
    owner,
    repo,
    router,
    scopedHref,
    selectedId,
    selectionScope,
    storedId,
  ]);

  const selectEnv = (env: PreviewEnvironment): void => {
    if (!environments.some((current) => current.id === env.id)) {
      pendingSelectionRef.current = env.id;
    } else {
      pendingSelectionRef.current = null;
    }
    setStoredId(env.id);
    try {
      window.localStorage.setItem(selectionKey(owner, repo), env.id);
    } catch {
      /* ignore */
    }
    setEnvironmentSelection((current) => ({
      id: env.id,
      revision: (current?.revision ?? 0) + 1,
    }));
    router.push(scopedHref(selectionPath("/preview", env.id)));
  };

  // The route-selection effect owns fallback. Opening the first environment
  // here would navigate the remote browser before the saved selection loads.
  const selectedEnv =
    environments.find((e) => e.id === selectedId) ?? null;
  const [remoteActiveEnvironmentId, setRemoteActiveEnvironmentId] = useState<
    string | null | undefined
  >(undefined);
  const selectedFlyBranch = isFlyBranchEnvironment(selectedEnv)
    ? selectedEnv.flyBranch
    : null;
  const selectedFlyBranchMatchesRepo =
    !!selectedFlyBranch && selectedFlyBranch.repo === repoFullName;
  const selectedPollingBranch = selectedFlyBranchMatchesRepo
    ? selectedFlyBranch.branch
    : null;
  const repoViewId = selectedFlyBranch
    ? null
    : repoViewIdFromPath(selectedEnv?.repoViewPath);
  const isRepoViewPdf =
    !!repoViewId && repoViewUrlLooksLikePdf(selectedEnv?.url);
  const branchPreviewsQuery = useQuery({
    queryKey: ["kody-branch-previews", owner, repo],
    queryFn: fetchBranchPreviews,
    enabled: !!selectedFlyBranchMatchesRepo && !!owner && !!repo,
    staleTime: 15 * 60 * 1000,
    refetchInterval: (query) =>
      branchPreviewNeedsPoll(selectedPollingBranch, query.state.data)
        ? BRANCH_PREVIEW_POLL_MS
        : false,
    retry: false,
  });
  const resolvedBranchPreview = selectedFlyBranch
    ? branchPreviewsQuery.data?.previews.find(
        (preview) => preview.branch === selectedFlyBranch.branch,
      )
    : null;
  const viewTicketQuery = useQuery({
    queryKey: ["kody-repo-view-ticket", owner, repo, repoViewId],
    queryFn: () => mintRepoViewTicket(repoViewId!),
    enabled: !!repoViewId && !!owner && !!repo,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
  const baseUrl = selectedFlyBranch
    ? (resolvedBranchPreview?.url ?? null)
    : selectedEnv?.url && repoViewId
      ? viewTicketQuery.data
        ? tokenizeRepoViewUrl(selectedEnv.url, viewTicketQuery.data.token)
        : null
      : (selectedEnv?.url ?? null);
  const branchPreviewIsResolving =
    !!selectedFlyBranchMatchesRepo &&
    !resolvedBranchPreview?.url &&
    (branchPreviewsQuery.isLoading ||
      branchPreviewsQuery.isFetching ||
      resolvedBranchPreview?.state === "pending" ||
      resolvedBranchPreview?.state === "building" ||
      resolvedBranchPreview?.state === "starting");

  useEffect(() => {
    const contextEnvironment =
      remoteActiveEnvironmentId === undefined
        ? selectedEnv
        : remoteActiveEnvironmentId
          ? (environments.find(
              (environment) => environment.id === remoteActiveEnvironmentId,
            ) ?? null)
          : null;
    const savedContext = previewChatContextBlock(contextEnvironment);
    setPreviewContext(savedContext);
    return () => setPreviewContext(null);
  }, [environments, remoteActiveEnvironmentId, selectedEnv, setPreviewContext]);

  useEffect(() => {
    if (viewTicketQuery.error) {
      toast.error(
        viewTicketQuery.error instanceof Error
          ? viewTicketQuery.error.message
          : "Failed to open repo-backed view",
      );
    }
  }, [viewTicketQuery.error]);

  useEffect(() => {
    const error = branchPreviewsQuery.error;
    if (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to open branch preview",
      );
    }
  }, [branchPreviewsQuery.error]);

  const saveMutation = useMutation({
    mutationFn: (next: PreviewEnvironment[]) =>
      saveDashboardConfig({
        namedPreviews: next,
        actorLogin: githubUser?.login,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["kody-dashboard-config"], data);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save environments",
      );
    },
  });

  const saveFoldersMutation = useMutation({
    mutationFn: (next: PreviewEnvironmentFolder[]) =>
      saveDashboardConfig({
        previewFolders: next,
        actorLogin: githubUser?.login,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["kody-dashboard-config"], data);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preview folders",
      );
    },
  });

  const persist = async (next: PreviewEnvironment[]): Promise<void> => {
    await saveMutation.mutateAsync(next);
  };

  const persistFolders = async (
    next: PreviewEnvironmentFolder[],
  ): Promise<void> => {
    await saveFoldersMutation.mutateAsync(next);
  };

  const addBranch = async (repoRef: string, branch: string): Promise<void> => {
    if (repoRef !== repoFullName) throw new Error("Use the connected repo");

    const cleanBranch = normalizeBranchName(branch);
    if (!cleanBranch) throw new Error("Enter a valid branch");

    const list = await fetchBranchPreviews();
    if (!list.flyConfigured) throw new Error("Fly previews are not configured");
    const tracked = list.previews.find(
      (preview) => preview.branch === cleanBranch,
    );
    if (!tracked) throw new Error("Create this branch preview in Fly first");

    const existing = environments.find(
      (env) =>
        isFlyBranchEnvironment(env) &&
        env.flyBranch.repo === repoRef &&
        env.flyBranch.branch === cleanBranch,
    );
    if (existing) {
      selectEnv(existing);
      toast.info(`"${existing.label}" is already saved`);
      return;
    }

    const next = addBranchPreviewEnvironment(
      environments,
      repoRef,
      cleanBranch,
    );
    await persist(next);
    const created = next[next.length - 1];
    if (created) selectEnv(created);
    toast.success(`Saved "${created?.label ?? cleanBranch}"`);
  };

  const saveCurrentUrlAsEnvironment = async (url: string): Promise<void> => {
    if (isTransientRepoViewUrl(url)) {
      toast.info("Repo-backed views are already saved as environments");
      return;
    }
    const normalizedUrl = normalizeEnvUrl(url);
    if (!normalizedUrl) {
      toast.error("Couldn't save current URL");
      return;
    }
    const existing = environments.find(
      (env) => (env.url ? normalizeEnvUrl(env.url) : null) === normalizedUrl,
    );
    if (existing) {
      selectEnv(existing);
      toast.info(`"${existing.label}" is already saved`);
      return;
    }
    const label = uniqueEnvironmentLabel(
      environments,
      labelFromPreviewUrl(normalizedUrl),
    );
    const next = addEnvironment(environments, label, normalizedUrl);
    const created = next[next.length - 1];
    if (!created || created.url !== normalizedUrl) {
      toast.error("Couldn't save current URL");
      return;
    }
    await persist(next);
    selectEnv(created);
    toast.success(`Saved "${created.label}"`);
  };

  const addWebsiteEnvironment = async (): Promise<void> => {
    const normalizedUrl = normalizeEnvUrl(websiteUrl);
    if (!normalizedUrl) {
      toast.error("Enter a valid website URL");
      return;
    }
    const label = websiteName.trim() || labelFromPreviewUrl(normalizedUrl);
    const next = addEnvironment(environments, label, normalizedUrl);
    const created = next[next.length - 1];
    if (!created) {
      toast.error("Couldn't save website");
      return;
    }
    await persist(next);
    setWebsiteName("");
    setWebsiteUrl("");
    selectEnv(created);
    toast.success(`Saved "${created.label}"`);
  };

  // Upload file(s) into the backend under views/<id> and
  // add the dashboard-served URL as a named preview environment.
  const uploadFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    try {
      const uploadContext =
        files.length === 1 ? await createUploadContext(files[0]!) : undefined;
      const res = await uploadRepoView(files);
      const next = addRepoViewEnvironment(
        environments,
        res.name,
        res.url,
        res.repoPath,
        uploadContext,
        {
          sourceUrl: res.sourceHtmlUrl ?? null,
          entryPath: res.entryPath ?? null,
        },
      );
      await persist(next);
      const created = next[next.length - 1];
      if (created) selectEnv(created);
      toast.success(
        files.length === 1
          ? `Saved "${res.name}" to ${res.repoPath}`
          : `Saved ${files.length} files to ${res.repoPath}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      throw err;
    }
  };

  const removeStatic = async (staticId: string): Promise<void> => {
    try {
      await destroyStaticPreview(staticId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to destroy preview",
      );
    }
  };

  const removeRepoView = async (repoViewPath: string): Promise<void> => {
    try {
      await deleteRepoView(repoViewPath);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete stored view",
      );
    }
  };

  // Push an uploaded preview's expiry out by another full TTL from now.
  const extendEnv = async (id: string): Promise<void> => {
    const next = setEnvExpiry(
      environments,
      id,
      Date.now() + STATIC_PREVIEW_TTL_MS,
    );
    await persist(next);
    toast.success("Extended — 7 more days");
  };

  // Lazy reaper: on load, destroy + drop any uploaded preview past its expiry.
  // No cron needed — cleanup happens whenever someone opens /preview. Runs
  // once per mount (guarded) so it doesn't loop on the persist-driven refetch.
  const reapedRef = useRef(false);
  useEffect(() => {
    if (configQuery.isLoading || reapedRef.current) return;
    const expired = expiredUploads(environments, Date.now());
    if (expired.length === 0) return;
    reapedRef.current = true;
    void (async () => {
      await Promise.allSettled(
        expired.map((e) =>
          e.staticId ? destroyStaticPreview(e.staticId) : Promise.resolve(),
        ),
      );
      const expiredIds = new Set(expired.map((e) => e.id));
      await persist(environments.filter((e) => !expiredIds.has(e.id)));
    })();
    // persist updates the cache → environments changes, but reapedRef stops a
    // re-run; depend on the loading flag + list so we fire once data is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQuery.isLoading, environments]);

  return (
    <section className="relative flex-1 min-w-0 min-h-0 flex flex-col">
      <PreviewPane
        baseUrl={baseUrl}
        isResolving={
          (!!repoViewId && viewTicketQuery.isLoading) ||
          branchPreviewIsResolving
        }
        owner={owner}
        repo={repo}
        showBrowserChrome
        enableRemoteBrowser
        browserActorLogin={githubUser?.login}
        environmentId={selectedEnv?.id ?? null}
        environmentSelectionRevision={
          environmentSelection && environmentSelection.id === selectedEnv?.id
            ? environmentSelection.revision
            : 0
        }
        onRemoteEnvironmentCommit={setRemoteActiveEnvironmentId}
        resolveBrowserUploadFiles={resolveBrowserUploadFiles}
        onRemoteActionRunnerChange={
          selectedId ? setPreviewActionRunner : undefined
        }
        iframeSandbox={
          isRepoViewPdf ? null : repoViewId ? REPO_VIEW_SANDBOX : undefined
        }
        onComposerInjection={setComposerInjection}
        onAttachmentInjection={setAttachmentInjection}
        onSaveCurrentUrl={saveCurrentUrlAsEnvironment}
        isSavingCurrentUrl={saveMutation.isPending}
        leadingToolbar={
          environments.length > 0 ? (
            <PreviewEnvSwitcher
              environments={environments}
              folders={previewFolders}
              repoFullName={repoFullName}
              selectedId={
                remoteActiveEnvironmentId === undefined
                  ? (selectedEnv?.id ?? null)
                  : remoteActiveEnvironmentId
              }
              onSelect={selectEnv}
              onSave={persist}
              onSaveFolders={persistFolders}
              onAddBranch={addBranch}
              onUpload={uploadFiles}
              onRemoveStatic={removeStatic}
              onRemoveRepoView={removeRepoView}
              onExtend={extendEnv}
              isSaving={saveMutation.isPending || saveFoldersMutation.isPending}
              variant="address"
            />
          ) : null
        }
        emptyState={
          configQuery.isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="w-full max-w-md flex flex-col gap-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
                    <MonitorPlay className="w-5 h-5 text-sky-300" />
                  </span>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    Add a website to preview
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Save any public website URL for previews and Quality tests.
                  </p>
                </div>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addWebsiteEnvironment();
                  }}
                >
                  <label className="flex flex-col gap-1 text-xs text-zinc-300">
                    Website name
                    <Input
                      aria-label="Website name"
                      value={websiteName}
                      onChange={(event) => setWebsiteName(event.target.value)}
                      placeholder="Production"
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-300">
                    Website URL
                    <Input
                      aria-label="Website URL"
                      type="url"
                      required
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      placeholder="https://example.com"
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-sky-500"
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending || !websiteUrl.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Globe2 className="h-3.5 w-3.5" />
                    Add website
                  </Button>
                </form>
                <PreviewBranchEnvForm
                  repoFullName={repoFullName}
                  submitLabel="Add branch preview"
                  isSaving={saveMutation.isPending}
                  onSubmit={addBranch}
                />
                <div className="flex items-center gap-2 text-[11px] text-zinc-600">
                  <span className="h-px flex-1 bg-zinc-800" />
                  or
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
                <PreviewFileUploadButton
                  onFiles={(files) => void uploadFiles(files)}
                  className="items-center justify-center rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload view files
                </PreviewFileUploadButton>
              </div>
            </div>
          )
        }
      />
    </section>
  );
}
