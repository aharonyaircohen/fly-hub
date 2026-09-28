/**
 * @fileType component
 * @domain kody
 * @pattern agent-control-page
 * @ai-summary Agent Control — list, view, create, edit, and delete agent.
 *   An agent is a pure reusable identity file at `agents/<slug>.md`
 *   in the backend: a markdown body describing the agent's
 *   intent, allowed commands, and restrictions. User-selected Agents can be
 *   made live through a primary Intent, dedicated AgentState, and an Agent Loop.
 *   The chat rail reuses the existing capability scope kind (an agent is
 *   structurally identical to a capability).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Checkbox } from "@kody-ade/base/ui/checkbox";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kody-ade/base/ui/select";
import {
  buildHeaders,
  getStoredAuth,
  handleResponse,
  kodyApi,
} from "@dashboard/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { selectionPath } from "../selection-routing";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { cn } from "../utils";
import {
  useCreateAgent,
  useDeleteAgent,
  useDispatchAgent,
  useAgents,
  useUpdateAgent,
} from "../hooks/useAgents";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { Agent } from "../api";
import { agentUiPermissions } from "../agent-ui-policy";
import { KODY_CHAT_AGENT } from "@kody-ade/workspace/context/frontmatter";
import { LIVE_SCHEDULE_OPTIONS } from "@dashboard/lib/schedule-options";
import { AGENT_TEMPLATE } from "../agent-template";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";
import { useChatScope } from "./ChatRailShell";

interface AgentsControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in AgentsPageTabs). */
  embedded?: boolean;
  selectedSlug?: string | null;
}

export function AgentsControl({
  embedded = false,
  selectedSlug = null,
}: AgentsControlProps = {}) {
  return (
    <AuthGuard>
      <AgentsControlInner embedded={embedded} selectedSlug={selectedSlug} />
    </AuthGuard>
  );
}

export function AgentsControlInner({
  embedded = false,
  selectedSlug = null,
}: AgentsControlProps = {}) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const {
    data: fetchedStaff,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useAgents();
  const rawStaff = useMemo(() => fetchedStaff ?? [], [fetchedStaff]);
  const staffLoaded = fetchedStaff !== undefined;

  // The API owns the complete resolved roster and keeps Kody first.
  const agent = rawStaff;

  const [showCreate, setShowCreate] = useState(false);
  const [editingMember, setEditingMember] = useState<Agent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [taskMember, setTaskMember] = useState<Agent | null>(null);

  const selectedMember = useMemo(
    () => agent.find((m) => m.slug === selectedSlug) ?? null,
    [agent, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agent;
    return agent.filter(
      (m) =>
        m.slug.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q),
    );
  }, [agent, search]);

  useEffect(() => {
    if (isLoading || !staffLoaded) return;
    if (agent.length === 0) {
      if (selectedSlug) router.replace(scopedHref("/agents"));
      return;
    }
    if (selectedSlug && !agent.some((member) => member.slug === selectedSlug)) {
      router.replace(scopedHref("/agents"));
      return;
    }
    if (!selectedSlug && autoSelectFirst) {
      router.replace(scopedHref(selectionPath("/agents", agent[0].slug)));
    }
  }, [
    agent,
    autoSelectFirst,
    isLoading,
    router,
    scopedHref,
    selectedSlug,
    staffLoaded,
  ]);

  const selectAgent = (slug: string | null, replace = false) => {
    const path = slug ? selectionPath("/agents", slug) : "/agents";
    if (replace) router.replace(scopedHref(path));
    else router.push(scopedHref(path));
  };

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteAgent(githubUser?.login);

  // Push chat context up to the persistent rail in the root layout.
  // An agent is structurally identical to a capability, so we reuse the
  // existing capability scope kind — the chat just needs the file's title/body
  // to answer questions about the selected member.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(
      selectedMember
        ? { kind: "capability", capability: selectedMember }
        : null,
    );
    return () => setScope(null);
  }, [selectedMember, setScope]);

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {/* Chat rail + sidebar come from the root layout (ChatRailShell). */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {agent.length} {agent.length === 1 ? "member" : "agent"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh agent"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="gap-1"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New member</span>
            </Button>
          </div>
        ) : (
          <PageHeader
            title="Agent Control"
            icon={Target}
            iconClassName="text-emerald-400"
            subtitle={`${agent.length} ${agent.length === 1 ? "member" : "agent"}`}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Refresh agent"
                >
                  <RefreshCw
                    className={cn("w-4 h-4", isFetching && "animate-spin")}
                  />
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowCreate(true)}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New member</span>
                </Button>
              </>
            }
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load agent: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: agent list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedMember && "hidden md:block",
            )}
          >
            {agent.length > 0 ? (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
                <ListSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search agent…"
                  ariaLabel="Search agent"
                  accent="emerald"
                />
              </div>
            ) : null}
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading agent…" />
            ) : agent.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No agent yet"
                hint="Create your first agent to describe the intent, system prompt, and restrictions."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No matching agent"
                hint="No agent matches your search. Try a different term."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((member) => {
                  const isActive = selectedSlug === member.slug;
                  const permissions = agentUiPermissions(member);
                  return (
                    <li key={member.slug}>
                      {/* eslint-disable-next-line react/forbid-elements -- unstyled clickable list row with block content; Button's inline-flex centering would break it */}
                      <button
                        type="button"
                        onClick={() => selectAgent(member.slug)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                          isActive && "bg-accent/70",
                        )}
                      >
                        {isActive ? (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Target
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-medium text-sm truncate flex-1">
                            {member.title}
                          </span>
                          <AgentLiveLabel member={member} />
                          {member.source === "store" ? (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                              Store
                            </span>
                          ) : null}
                          {member.source === "builtin" ? (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-teal-500/10 text-teal-300 border border-teal-500/20">
                              Built-in
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-mono opacity-80">
                            {member.slug}
                          </span>
                          {!permissions.isCodeOwned ? (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(
                                  member.updatedAt,
                                ).toLocaleDateString()}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: agent detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedMember && "hidden md:block",
            )}
          >
            {selectedMember ? (
              <StaffDetail
                member={selectedMember}
                onBack={() => selectAgent(null)}
                onEdit={() => setEditingMember(selectedMember)}
                onDelete={() => {
                  setPendingDelete(selectedMember);
                }}
                onSendTask={() => setTaskMember(selectedMember)}
              />
            ) : (
              <EmptyState
                icon={<Target />}
                title="Select an agent"
                hint="Pick an agent from the list to see its intent and system prompt."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateAgentDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(member) => {
            selectAgent(member.slug);
            setShowCreate(false);
          }}
        />

        {/* Edit */}
        {editingMember ? (
          <EditStaffDialog
            member={editingMember}
            availableAgents={agent}
            onClose={() => setEditingMember(null)}
            onSaved={() => setEditingMember(null)}
          />
        ) : null}

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title={
            pendingDelete?.source === "store"
              ? "Remove Store agent?"
              : "Delete this agent?"
          }
          description={
            pendingDelete
              ? pendingDelete.source === "store"
                ? `Agent member "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from this repo's active Store agents. The Store asset will not be deleted.`
                : `Agent member "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from the backend agent store.`
              : ""
          }
          variant="destructive"
          confirmLabel={
            pendingDelete?.source === "store"
              ? "Remove member"
              : "Delete member"
          }
          onConfirm={() => {
            if (!pendingDelete) return;
            const target = pendingDelete;
            deleteMutation.mutate(target.slug, {
              onSuccess: () => {
                if (selectedSlug === target.slug) selectAgent(null, true);
              },
            });
          }}
          onClose={() => setPendingDelete(null)}
        />

        {/* Send ad-hoc task */}
        {taskMember ? (
          <SendTaskDialog
            member={taskMember}
            onClose={() => setTaskMember(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function StaffDetail({
  member,
  onBack,
  onEdit,
  onDelete,
  onSendTask,
}: {
  member: Agent;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSendTask: () => void;
}) {
  const hasBody = member.body.trim().length > 0;
  const permissions = agentUiPermissions(member);
  const canConfigure =
    permissions.canConfigureIdentity || permissions.canConfigureSubagents;
  return (
    <article className="min-h-full">
      {/* Hero */}
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All agent
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {member.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{member.slug}</span>
                {member.source === "store" ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      Store
                    </span>
                  </>
                ) : null}
                {permissions.isCodeOwned ? (
                  <>
                    <span>·</span>
                    <span>Built-in agentIdentity</span>
                  </>
                ) : (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      updated {new Date(member.updatedAt).toLocaleDateString()}
                    </span>
                    <span>·</span>
                    <a
                      href={member.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-3 h-3" />
                      GitHub
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {member.slug !== KODY_CHAT_AGENT ? (
                <Button
                  size="sm"
                  onClick={onSendTask}
                  className="w-9 px-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                  title="Send an ad-hoc task to this agent"
                  aria-label="Send task"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              ) : null}
              {canConfigure ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  className="w-9 px-0"
                  title={
                    member.slug === KODY_CHAT_AGENT
                      ? "Configure specialists"
                      : "Edit agent"
                  }
                  aria-label={
                    member.slug === KODY_CHAT_AGENT
                      ? "Configure specialists"
                      : "Edit agent"
                  }
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              ) : null}
              {permissions.canDelete ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="w-9 px-0 text-red-400"
                  title={
                    member.source === "store"
                      ? "Remove Store agent from this repo"
                      : "Delete agent"
                  }
                  aria-label={
                    member.source === "store"
                      ? "Remove Store agent from this repo"
                      : "Delete agent"
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              ) : null}
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <MarkdownPreview content={member.body} />
            </div>
          ) : null}
          {member.whenToUse ? (
            <div className="space-y-1">
              <h2 className="text-sm font-medium">When to use</h2>
              <p className="text-sm text-muted-foreground">
                {member.whenToUse}
              </p>
            </div>
          ) : null}
          <LiveAgentPanel member={member} />
          {member.subagents?.length ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">Subagents</h2>
              <div className="flex flex-wrap gap-2">
                {member.subagents.map((slug) => (
                  <span
                    key={slug}
                    className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-300"
                  >
                    {slug}
                    {member.lockedSubagents?.includes(slug) ? (
                      <span className="ml-1 font-sans opacity-70">default</span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero */}
      {!hasBody ? (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No description yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Use <span className="font-medium text-foreground">Edit</span> to
                describe the agent&apos;s intent, system prompt, allowed
                commands, and restrictions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="gap-1.5 mt-1"
              title={
                member.readOnly
                  ? "Edit — saves a repo copy that overrides the Store version"
                  : "Edit agent"
              }
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit agent
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface LiveAgentStatus {
  agent: string;
  live: boolean;
  paused: boolean;
  intent: string | null;
  schedule: string | null;
  loopId: string;
  state: {
    revision: number;
    cursor: string;
    summary: string;
    updatedAt: string;
  } | null;
  consistency: "ready" | "inactive" | "missing-state" | "missing-intent";
}

async function fetchLiveAgentStatus(agent: string): Promise<LiveAgentStatus> {
  return (
    await handleResponse<{ status: LiveAgentStatus }>(
      await fetch(`/api/kody/agents/${encodeURIComponent(agent)}/live`, {
        headers: buildHeaders(),
        cache: "no-store",
      }),
    )
  ).status;
}

function useLiveAgentStatus(agent: string) {
  return useQuery({
    queryKey: ["live-agent", agent],
    queryFn: () => fetchLiveAgentStatus(agent),
  });
}

function AgentLiveLabel({ member }: { member: Agent }) {
  const status = useLiveAgentStatus(member.slug);
  if (!status.data?.live) return null;
  return (
    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
      {status.data.paused ? "Paused" : "Live"}
    </span>
  );
}

function LiveAgentPanel({ member }: { member: Agent }) {
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [intent, setIntent] = useState(member.primaryIntent ?? "");
  const [schedule, setSchedule] = useState("1h");
  const statusKey = ["live-agent", member.slug] as const;
  const status = useLiveAgentStatus(member.slug);
  const intents = useQuery({
    queryKey: ["agent-live-intents"],
    queryFn: async () =>
      (
        await handleResponse<{
          entries: Array<{ slug: string; body: string }>;
        }>(
          await fetch("/api/kody/intents", {
            headers: buildHeaders(),
            cache: "no-store",
          }),
        )
      ).entries,
  });
  const operation = useMutation({
    mutationFn: async (
      action:
        | { action: "activate"; intent: string; every: string }
        | { action: "run" | "pause" | "resume" | "reset" | "stop" },
    ) =>
      handleResponse(
        await fetch(
          `/api/kody/agents/${encodeURIComponent(member.slug)}/live`,
          {
            method: action.action === "stop" ? "DELETE" : "POST",
            headers: buildHeaders(),
            ...(action.action === "stop"
              ? {}
              : { body: JSON.stringify(action) }),
          },
        ),
      ),
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      setConfiguring(false);
      setStopping(false);
      toast.success(
        action.action === "activate"
          ? "Agent is live"
          : action.action === "stop"
            ? "Agent stopped"
            : `Live Agent ${action.action} completed`,
      );
    },
    onError: (error: Error) =>
      toast.error("Live Agent operation failed", {
        description: error.message,
      }),
  });

  if (status.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading live status…</p>
    );
  }
  if (status.error) {
    return <p className="text-sm text-red-400">Could not load live status.</p>;
  }
  const current = status.data;
  if (!current?.live && current?.consistency === "inactive") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div>
          <h2 className="text-sm font-medium">Not live</h2>
          <p className="text-xs text-muted-foreground">Runs only when called</p>
        </div>
        <Button
          size="icon"
          onClick={() => setConfiguring(true)}
          aria-label="Start live Agent"
          title="Start live Agent"
        >
          <Play className="h-4 w-4" />
        </Button>
        <Dialog open={configuring} onOpenChange={setConfiguring}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Make {member.title} live</DialogTitle>
              <DialogDescription>
                Choose what this Agent continuously pursues and how often it
                wakes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Primary Intent</Label>
                <Select value={intent} onValueChange={setIntent}>
                  <SelectTrigger aria-label="Primary Intent">
                    <SelectValue placeholder="Select Intent" />
                  </SelectTrigger>
                  <SelectContent>
                    {(intents.data ?? []).map((entry) => (
                      <SelectItem key={entry.slug} value={entry.slug}>
                        {entry.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Schedule</Label>
                <Select value={schedule} onValueChange={setSchedule}>
                  <SelectTrigger aria-label="Schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIVE_SCHEDULE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="ghost" onClick={() => setConfiguring(false)}>
                Cancel
              </Button>
              <Button
                disabled={!intent || operation.isPending}
                onClick={() =>
                  operation.mutate({
                    action: "activate",
                    intent,
                    every: schedule,
                  })
                }
              >
                {operation.isPending ? "Starting…" : "Make live"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">
            {current?.paused ? "Paused" : "Live"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {current?.intent ?? "Missing Intent"} ·{" "}
            {current?.schedule ?? "No schedule"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="icon"
            variant="outline"
            onClick={() =>
              operation.mutate({ action: current?.paused ? "resume" : "pause" })
            }
            disabled={operation.isPending}
            aria-label={
              current?.paused ? "Resume live Agent" : "Pause live Agent"
            }
            title={current?.paused ? "Resume live Agent" : "Pause live Agent"}
          >
            {current?.paused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => operation.mutate({ action: "reset" })}
            disabled={operation.isPending}
            aria-label="Reset Agent state"
            title="Reset Agent state"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="text-red-400"
            onClick={() => setStopping(true)}
            disabled={operation.isPending}
            aria-label="Stop live Agent"
            title="Stop live Agent"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {current?.state?.summary || "No activity yet"}
      </p>
      {current?.consistency !== "ready" ? (
        <p className="text-sm text-amber-300">
          Live configuration needs repair: {current?.consistency}.
        </p>
      ) : null}
      <ConfirmDialog
        open={stopping}
        title="Stop this live Agent?"
        description="The Agent and its resources stay available. Its Loop and continuation state will be removed."
        variant="destructive"
        confirmLabel="Stop being live"
        onConfirm={() => operation.mutate({ action: "stop" })}
        onClose={() => setStopping(false)}
      />
    </div>
  );
}

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (member: Agent) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateAgent(githubUser?.login);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState(AGENT_TEMPLATE);
  const [whenToUse, setWhenToUse] = useState("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(AGENT_TEMPLATE);
      setWhenToUse("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      {
        title: title.trim(),
        body,
        ...(whenToUse.trim() ? { whenToUse: whenToUse.trim() } : {}),
      },
      {
        onSuccess: (member) => onCreated(member),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Describe the agent&apos;s intent, system prompt, allowed commands,
            and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent-title">Title</Label>
            <Input
              id="agent-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Release notes manager"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-when-to-use">
              When to use as a specialist
            </Label>
            <Input
              id="agent-when-to-use"
              value={whenToUse}
              onChange={(event) => setWhenToUse(event.target.value)}
              placeholder="Use for release coordination and CI blockers."
              maxLength={500}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create member"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Checklist of the repo's capabilities; toggles which are attached. */
function CapabilitiesChecklist({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (slug: string, on: boolean) => void;
}) {
  const { auth } = useAuth();
  const [options, setOptions] = useState<{ slug: string; describe?: string }[]>(
    [],
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!auth || !getStoredAuth()) return;
    let active = true;
    kodyApi.capabilities
      .list()
      .then((caps) => {
        if (active)
          setOptions(caps.map((c) => ({ slug: c.slug, describe: c.describe })));
      })
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [auth]);

  return (
    <div className="space-y-1.5">
      <Label>Capabilities</Label>
      <p className="text-xs text-muted-foreground">
        Attach capabilities — their instructions and tools load into this
        agent&apos;s chat.
      </p>
      <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {!loaded ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : options.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No capabilities defined yet.
          </div>
        ) : (
          options.map((cap) => (
            <label
              key={cap.slug}
              className="flex items-start gap-2 rounded px-1 py-1 text-sm"
            >
              <Checkbox
                checked={selected.includes(cap.slug)}
                onCheckedChange={(on) => onToggle(cap.slug, on === true)}
              />
              <span className="min-w-0">
                <span className="font-medium">{cap.slug}</span>
                {cap.describe ? (
                  <span className="ml-2 text-muted-foreground">
                    {cap.describe}
                  </span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/** Public Agents this Agent can invoke as isolated subagents. */
function SubagentsChecklist({
  ownerSlug,
  options,
  selected,
  locked,
  onToggle,
}: {
  ownerSlug: string;
  options: Agent[];
  selected: string[];
  locked: string[];
  onToggle: (slug: string, on: boolean) => void;
}) {
  const candidates = options.filter((agent) => agent.slug !== ownerSlug);

  return (
    <div className="space-y-1.5">
      <Label>Subagents</Label>
      <p className="text-xs text-muted-foreground">
        Assigned public Agents can receive focused work and return their result
        to this Agent.
      </p>
      <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {candidates.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No other Agents are available.
          </div>
        ) : (
          candidates.map((agent) => (
            <label
              key={agent.slug}
              className="flex items-start gap-2 rounded px-1 py-1 text-sm"
            >
              <Checkbox
                aria-label={`Assign ${agent.title} as subagent`}
                checked={selected.includes(agent.slug)}
                disabled={
                  locked.includes(agent.slug) ||
                  (!selected.includes(agent.slug) && !agent.whenToUse?.trim())
                }
                onCheckedChange={(on) => onToggle(agent.slug, on === true)}
              />
              <span className="min-w-0">
                <span className="font-medium">{agent.title}</span>
                <span className="ml-2 font-mono text-muted-foreground">
                  {agent.slug}
                </span>
                {locked.includes(agent.slug) ? (
                  <span className="ml-2 text-muted-foreground">Default</span>
                ) : !agent.whenToUse?.trim() ? (
                  <span className="ml-2 text-amber-300">
                    Add “When to use” first
                  </span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function EditStaffDialog({
  member,
  availableAgents,
  onClose,
  onSaved,
}: {
  member: Agent;
  availableAgents: Agent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateAgent(member.slug, githubUser?.login);
  const createMutation = useCreateAgent(githubUser?.login);
  const permissions = agentUiPermissions(member);
  const configuresOnlySubagents =
    permissions.canConfigureSubagents && !permissions.canConfigureIdentity;
  // Store definitions have no persisted local file until the first save.
  const isFilelessStore = member.source === "store" && !member.updatedAt;

  const [title, setTitle] = useState(member.title);
  const [body, setBody] = useState(member.body || "");
  const [whenToUse, setWhenToUse] = useState(member.whenToUse ?? "");
  const [capabilities, setCapabilities] = useState<string[]>(
    member.capabilities ?? [],
  );
  const [subagents, setSubagents] = useState<string[]>(member.subagents ?? []);

  useEffect(() => {
    setTitle(member.title);
    setBody(member.body || "");
    setWhenToUse(member.whenToUse ?? "");
    setCapabilities(member.capabilities ?? []);
    setSubagents(member.subagents ?? []);
  }, [member]);

  const toggleCapability = (slug: string, on: boolean) =>
    setCapabilities((current) =>
      on ? [...new Set([...current, slug])] : current.filter((s) => s !== slug),
    );
  const toggleSubagent = (slug: string, on: boolean) =>
    setSubagents((current) =>
      on ? [...new Set([...current, slug])] : current.filter((s) => s !== slug),
    );

  const sameCapabilities = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending || createMutation.isPending)
      return;
    if (configuresOnlySubagents) {
      updateMutation.mutate({ subagents }, { onSuccess: () => onSaved() });
      return;
    }
    if (isFilelessStore) {
      createMutation.mutate(
        {
          slug: member.slug,
          title: title.trim(),
          body,
          ...(whenToUse.trim() ? { whenToUse: whenToUse.trim() } : {}),
          capabilities,
          subagents,
        },
        { onSuccess: () => onSaved() },
      );
      return;
    }
    const patch: {
      title?: string;
      body?: string;
      whenToUse?: string;
      capabilities?: string[];
      subagents?: string[];
    } = {};
    if (title !== member.title) patch.title = title.trim();
    if (body !== member.body) patch.body = body;
    if (whenToUse !== (member.whenToUse ?? "")) {
      patch.whenToUse = whenToUse.trim();
    }
    if (!sameCapabilities(capabilities, member.capabilities ?? [])) {
      patch.capabilities = capabilities;
    }
    if (!sameCapabilities(subagents, member.subagents ?? [])) {
      patch.subagents = subagents;
    }
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {configuresOnlySubagents
              ? "Configure Kody specialists"
              : `Edit agent \`${member.slug}\``}
          </DialogTitle>
          <DialogDescription>
            {configuresOnlySubagents
              ? "The six built-in specialists stay assigned. You can add configured Agents."
              : "Update this Agent's identity, routing guidance, and assignments."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {!configuresOnlySubagents ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-agent-title">Title</Label>
                <Input
                  id="edit-agent-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-agent-when-to-use">
                  When to use as a specialist
                </Label>
                <Input
                  id="edit-agent-when-to-use"
                  value={whenToUse}
                  onChange={(event) => setWhenToUse(event.target.value)}
                  placeholder="Use for release coordination and CI blockers."
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Body</Label>
                <MarkdownEditor value={body} onChange={setBody} rows={14} />
              </div>
              <CapabilitiesChecklist
                selected={capabilities}
                onToggle={toggleCapability}
              />
            </>
          ) : null}
          <SubagentsChecklist
            ownerSlug={member.slug}
            options={availableAgents}
            selected={subagents}
            locked={member.lockedSubagents ?? []}
            onToggle={toggleSubagent}
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={
              !title.trim() ||
              updateMutation.isPending ||
              createMutation.isPending
            }
          >
            {updateMutation.isPending || createMutation.isPending
              ? "Saving…"
              : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SendTaskDialog({
  member,
  onClose,
}: {
  member: Agent;
  onClose: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const dispatchMutation = useDispatchAgent(githubUser?.login);

  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage("");
  }, [member]);

  const handleSubmit = () => {
    if (!message.trim() || dispatchMutation.isPending) return;
    dispatchMutation.mutate(
      { slug: member.slug, message: message.trim() },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send a task to {member.title}</DialogTitle>
          <DialogDescription>
            Runs <span className="font-mono">{member.slug}</span> once on your
            message — like a one-off capability. The reply is posted on the Kody
            control issue
            {githubUser?.login ? " and lands in your inbox" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 mt-2">
          <Label>Message</Label>
          <MarkdownEditor value={message} onChange={setMessage} rows={8} />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!message.trim() || dispatchMutation.isPending}
            className="gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            {dispatchMutation.isPending ? "Sending…" : "Send task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  );
}
