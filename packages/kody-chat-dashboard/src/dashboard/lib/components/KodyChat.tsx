"use client";
/* eslint-disable max-lines -- legacy host component; extracted concerns keep this bounded for now. */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { navLabelForPath } from "../feature-catalog";
import { useLiveRunner } from "./kody-chat-live-runner";
import {
  createChatPluginRegistry,
  FULL_GRANT,
  trace,
  type ChatHostEffect,
} from "../chat/platform";
import { ChatSurfaceLayout } from "../chat/surface/ChatSurfaceLayout";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { toast } from "sonner";
import type { KodyTask } from "@kody-ade/base/types";
// Terminal HOST wiring (phase 1.6d): registry, checkpoints, payload
// hand-off, chrome state + the lazy terminal chrome nodes all live in
// the useTerminalHost hook (kody-chat-terminal-host.tsx). Only the
// effect reader (send-middleware hand-off) stays imported here.
import {
  readTerminalIntentEffect,
  type TerminalIntentEffectPayload,
} from "../chat/plugins/terminal/intent-middleware";
import { useTerminalHost } from "./kody-chat-terminal-host";
import { useComposerHandlers } from "./kody-chat-composer-handlers";
import {
  SlashCommandMenu,
  parseSlashTrigger,
  readSlashExpansionEffect,
  useSlashCommands,
  type SlashExpansionEffectPayload,
} from "../chat/plugins/commands";
import { useElementPicker } from "../picker/useElementPicker";
import { formatPageInfo } from "../picker/protocol";
import { runPreviewAction } from "../picker/run-preview-action";
import {
  consumePendingViewsCapabilityAction,
  ensureViewsOwnedCapabilityAction,
  isSelectedViewPath,
  isViewsPath,
  stagePendingViewsCapabilityAction,
} from "../picker/views-owned-preview-action";
import { getViewsPreviewActionRunner } from "../picker/views-preview-action-runner";
import { formatMacrosCatalog, type Macro } from "../macros";
import { authHeaders, clearLiveSession } from "../kody-chat-live-session";
import { runSendText, runSendMessage, type SendTextFn } from "./kody-chat-send";
import {
  compactConversationForTurn,
  useCompactionStatus,
} from "./kody-chat-compaction";
import {
  chatToMessage,
  messageToChat,
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import type { ChatMessage } from "../chat-types";
import { putAttachment, deleteAttachment } from "../attachment-store";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ChatIssueReportDialog,
  type ChatIssueReportState,
} from "./ChatIssueReportDialog";
import { useRemoteStatus } from "../hooks/useRemoteStatus";
import { useAgents } from "../hooks/useAgents";
import { kodyApi } from "../integration-api";
import { useChatDataSources } from "./kody-chat-data";
import {
  resolveDefaultAgentEntry,
  useAgentSelection,
} from "./kody-chat-selection";
import { useVoiceOrchestration } from "./kody-chat-voice";
import { PIPER_VOICES } from "../voice/voices";
import { VoiceChatOverlay } from "./VoiceChatOverlay";
import { useConversationSessions } from "../chat/core/conversation/use-conversation-sessions";
import { useMachineAccessSelection } from "../chat/core/use-machine-access-selection";
import { useLocalMachineAvailability } from "../chat/core/use-machine-availability";
import {
  machineAccessForEntrySelection,
  modelEntriesForMachineAccess,
} from "../chat/core/machine-access";
import type { MachineAccess } from "../chat-types";
import { useKodyActionState } from "../hooks/useKodyActionState";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { SessionsPanel } from "../chat/surface/SessionsPanel";
import { HeaderControls } from "../chat/surface/HeaderControls";
import type { ChatSetupSection } from "../chat/surface/ChatSetupControl";
import {
  isModelOutputRecoveryView,
  MODEL_OUTPUT_RECOVERY_ACTION,
} from "../chat/core/model-output-recovery";
import { MessageList } from "../chat/surface/MessageList";
import type { WidgetHostEvent } from "../chat/surface/widget-host";
import { Composer } from "../chat/surface/Composer";
import type { StaffMentionTrigger } from "../mentions/agent-mentions";
import { EmptyState } from "../chat/surface/EmptyState";
import type { RecentVibeIssue } from "../chat/plugins/vibe";
import type {
  DashboardNavigateDirective,
  RenderedViewAction,
  RenderedViewDirective,
  PreviewActDirective,
} from "../chat-ui-actions";
import { settleActiveAssistants } from "./kody-chat-turn-surface";
import { isRenderedViewDirective } from "../chat-ui-actions";
import { useGuidedFlowCommandCompletion } from "../guided-flows/use-command-completion";
import type { GuidedFlowOpenRequest } from "../guided-flows/chat-controller";
import { buildGuidedFlowResumeView } from "../guided-flows/resume";
import { guidedFlowActionErrorMessage } from "../guided-flows/errors";
import {
  guidedFlowMessageId,
  locationAfterGuidedFlowLaunch,
  replaceGuidedFlowChatMessage,
  shouldAutoResumeGuidedFlows,
} from "../guided-flows/chat-launch";
import { readGuidedFlowOpenPayload } from "../guided-flows/open-response";
import { guidedFlowChangeForViewAction } from "../guided-flows/chat-action";
import { addGuidedFlowFilePickerReturnHref } from "../guided-flows/file-picker";
import { PROJECT_ASSESSMENT_FLOW_ID } from "../guided-flows/builtins";
import {
  buildWidgetPreviewView,
  consumeWidgetOpenRequest,
  isWidgetPreviewView,
  isWidgetOpenRequest,
  setActiveWidgetConversationId,
  WIDGET_OPEN_EVENT,
  type WidgetOpenRequest,
} from "../widgets/chat-launch";
import { repoScopedHref } from "@kody-ade/base/routes";
import {
  buildRepositoryChatOpeningView,
  PROJECT_ASSESSMENT_OPENING_ACTION,
} from "../chat/core/chat-opening";
import { buildProjectAssessmentSubmission } from "../chat/core/project-assessment-submission";

const EMPTY_OPENING_ACTIONS: readonly RenderedViewAction[] = [];

function reportValue(value: unknown, max = 1_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join(", ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function reportItem(
  label: string,
  value: unknown,
  max?: number,
): { label: string; value: string } | null {
  const normalized = reportValue(value, max);
  return normalized ? { label, value: normalized } : null;
}

function compactReportItems(
  items: Array<{ label: string; value: string } | null>,
): Array<{ label: string; value: string }> {
  return items.filter(Boolean) as Array<{ label: string; value: string }>;
}

export function KodyChat({
  conversationId,
  onConversationChange,
  guidedFlowRequest,
  onGuidedFlowRequestHandled,
  context,
  actorLogin,
  onClose,
  onCollapseRail,
  onToggleFullscreen,
  railFullscreen,
  emptyStateWelcome,
  openingActions = EMPTY_OPENING_ACTIONS,
  onOpeningAction,
  lockedAgentId,
  lockedModelId,
  lockedAgentSlug,
  allowAgencyAgentSelection = true,
  hideAgentPicker,
  compactHeader,
  allowSessionSidebarPin = true,
  autoOpenSessionSidebar = true,
  kodyDirectHeaders,
  messageRoleLayout,
  vibeMode,
  onIssueCreated,
  onIssueReportReady,
  composerInjection,
  attachmentInjection,
  previewContext,
  previewActionRunner,
  getPreviewActionRunner,
  presentation = "rail",
  hideTerminalMode,
  plugins,
  capabilityGrant,
}: KodyChatProps) {
  const router = useRouter();
  // Current route — drives the page-aware composer placeholder AND tells the
  // model which dashboard page the user is looking at ("what am I viewing?").
  const pathname = usePathname();
  const pageLabel = navLabelForPath(pathname);
  // Noun phrase passed to the backends. The client owns nav labels; each
  // route owns how it frames this (system section vs. user-turn prefix).
  const currentPage = pathname
    ? pageLabel
      ? `the ${pageLabel} page (${pathname})`
      : `the page at ${pathname}`
    : null;
  // Read at send-time from inside send callbacks (which may close over a stale
  // render), so a ref always reflects the page the user is on right now.
  const currentPageRef = useRef<string | null>(currentPage);
  currentPageRef.current = currentPage;
  const pathnameRef = useRef<string | null>(pathname);
  pathnameRef.current = pathname;
  // Context-kind derivations.
  const selectedOrg = context?.kind === "org" ? context : null;
  const selectedTask: KodyTask | null =
    context?.kind === "task" ? context.task : null;
  const selectedCapability =
    context?.kind === "capability" ? context.capability : null;
  // Report mode: chat scoped to a markdown report on /reports. The agent
  // is framed to advise: create an issue or take no action.
  const selectedReport = context?.kind === "report" ? context.report : null;
  const selectedApp = context?.kind === "app" ? context.app : null;

  // Per-scope (task / capability / global) scope blocks flow through
  // the existing per-turn system-prompt blocks (## Current task / ## Current
  // capability / ## Current report). The thread itself is
  // one global store keyed by sessionId — no per-scope parallel stores.

  const [input, setInput] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown }>).detail;
      if (typeof detail?.message !== "string" || !detail.message.trim()) return;
      sessionStorage.removeItem("kody:pending-chat-prefill");
      setInput(detail.message.trim());
      requestAnimationFrame(() => composerTextareaRef.current?.focus());
    };
    window.addEventListener("kody:prefill-chat", prefill);
    const pending = sessionStorage.getItem("kody:pending-chat-prefill");
    if (pending) {
      sessionStorage.removeItem("kody:pending-chat-prefill");
      setInput(pending);
    }
    return () => window.removeEventListener("kody:prefill-chat", prefill);
  }, []);
  const [agentMentionTrigger, setAgentMentionTrigger] =
    useState<StaffMentionTrigger | null>(null);
  const [agentMentionSelectedIndex, setAgentMentionSelectedIndex] = useState(0);
  // Context chips attached to the composer (e.g. picked preview elements).
  // Shown as removable pills above the input; their `context` is appended to
  // the outgoing message on send so the visible input stays clean.
  const [contextChips, setContextChips] = useState<
    Array<{ id: string; label: string; context: string }>
  >([]);
  // Add a picker selection as a chip. Keyed by id so a re-render with the same
  // selection doesn't double-add; a new id adds exactly one chip.
  const lastInjectionIdRef = useRef<string | null>(null);
  const [resumedGuidedFlowMessage, setResumedGuidedFlowMessage] = useState<{
    sessionId: string | null;
    message: Message;
  } | null>(null);
  const [openingStatusCheckedSessionId, setOpeningStatusCheckedSessionId] =
    useState<string | null>(null);
  const createGuidedFlowSessionRef = useRef<() => string>(() => "");
  const activateGuidedFlowSessionRef = useRef<(sessionId: string) => void>(
    () => undefined,
  );
  const openGuidedFlow = useCallback(
    async (request: GuidedFlowOpenRequest): Promise<boolean> => {
      const requestKey =
        "flowId" in request
          ? `flow:${request.flowId}:${request.instanceKey ?? ""}`
          : `instance:${request.instanceId}`;
      if (guidedFlowOpenInFlightRef.current.has(requestKey)) return false;
      guidedFlowOpenInFlightRef.current.add(requestKey);
      try {
        const requestAuthHeaders = authHeaders();
        if ("flowId" in request && request.sourceScope?.kind === "user") {
          delete requestAuthHeaders["x-kody-owner"];
          delete requestAuthHeaders["x-kody-repo"];
        } else if (
          "flowId" in request &&
          request.sourceScope?.kind === "repository"
        ) {
          requestAuthHeaders["x-kody-owner"] = request.sourceScope.owner;
          requestAuthHeaders["x-kody-repo"] = request.sourceScope.repo;
        }
        const conversationId =
          activeGuidedFlowSessionIdRef.current ??
          createGuidedFlowSessionRef.current();
        activeGuidedFlowSessionIdRef.current = conversationId;
        const response =
          "flowId" in request
            ? await fetch("/api/kody/guided-flows", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...requestAuthHeaders,
                },
                body: JSON.stringify({
                  action: "start",
                  flowId: request.flowId,
                  conversationId,
                  ...(request.instanceKey
                    ? { instanceKey: request.instanceKey }
                    : {}),
                }),
              })
            : await fetch("/api/kody/guided-flows", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...requestAuthHeaders,
                },
                body: JSON.stringify({
                  action: "bind",
                  instanceId: request.instanceId,
                  conversationId,
                }),
              });
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
          view?: unknown;
          compatibility?: { status?: unknown; code?: unknown };
          flow?: {
            view?: unknown;
            compatibility?: { status?: unknown; code?: unknown };
          };
        } | null;
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "guided_flow_action_failed",
          );
        }
        const flowPayload = readGuidedFlowOpenPayload(payload);
        if (flowPayload.compatibility?.status === "incompatible") {
          throw new Error(
            typeof flowPayload.compatibility.code === "string"
              ? flowPayload.compatibility.code
              : "renderer_contract_invalid",
          );
        }
        const view = flowPayload.view;
        if (!isRenderedViewDirective(view)) {
          throw new Error("renderer_contract_invalid");
        }
        const message: Message = {
          role: "assistant",
          content:
            request.message === "started"
              ? "GuidedFlow started. Follow the steps below."
              : "GuidedFlow resumed. Continue where you stopped.",
          timestamp: new Date().toISOString(),
          view,
        };
        activateGuidedFlowSessionRef.current(conversationId);
        setResumedGuidedFlowMessage({ sessionId: conversationId, message });
        persistGuidedFlowMessageRef.current(conversationId, message);
        return true;
      } catch (error) {
        toast.error(
          guidedFlowActionErrorMessage(
            error instanceof Error ? error.message : undefined,
          ),
        );
        return false;
      } finally {
        guidedFlowOpenInFlightRef.current.delete(requestKey);
      }
    },
    [],
  );

  useEffect(() => {
    if (!guidedFlowRequest) return;
    void openGuidedFlow(guidedFlowRequest.request).finally(() => {
      onGuidedFlowRequestHandled?.(guidedFlowRequest.id);
    });
  }, [guidedFlowRequest, onGuidedFlowRequestHandled, openGuidedFlow]);

  useEffect(() => {
    if (
      !composerInjection ||
      composerInjection.id === lastInjectionIdRef.current
    ) {
      return;
    }
    lastInjectionIdRef.current = composerInjection.id;
    setContextChips((prev) => [...prev, composerInjection]);
  }, [composerInjection]);
  const removeContextChip = useCallback((id: string) => {
    setContextChips((prev) => prev.filter((c) => c.id !== id));
  }, []);
  // Add an injected image (e.g. a preview screenshot) as a chat attachment,
  // mirroring a user file drop. Keyed by id so re-renders don't duplicate it.
  const lastAttachmentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !attachmentInjection ||
      attachmentInjection.id === lastAttachmentIdRef.current
    ) {
      return;
    }
    lastAttachmentIdRef.current = attachmentInjection.id;
    const { id, name, dataUrl, mimeType } = attachmentInjection;
    void (async () => {
      let storedId = id;
      let size = 0;
      try {
        const blob = await (await fetch(dataUrl)).blob();
        size = blob.size;
        const ref = await putAttachment({ name, mimeType, size, blob });
        storedId = ref.id;
      } catch (err) {
        console.error("Screenshot attachment failed to persist:", err);
        toast.error("Could not attach the screenshot");
        return;
      }
      setAttachments((prev) => [
        ...prev,
        { id: storedId, name, type: mimeType, size, data: dataUrl, mimeType },
      ]);
    })();
  }, [attachmentInjection]);
  // Slash command autocomplete state. Open while the user is typing the
  // slug portion of `/foo` (no space yet). Once a space is typed the
  // menu closes and we treat the rest of the line as arguments. Enter
  // expands `/slug args` against the prompt list before sending.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const [, setLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [usedViewIds, setUsedViewIds] = useState<Set<string>>(() => new Set());
  const activeGuidedFlowSessionIdRef = useRef<string | null>(null);
  const guidedFlowOpenInFlightRef = useRef<Set<string>>(new Set());
  const persistedGuidedFlowViewKeysRef = useRef<Set<string>>(new Set());
  const persistGuidedFlowMessageRef = useRef<
    (sessionId: string | null, message: Message) => void
  >(() => undefined);
  const pendingGuidedFlowMessageRef = useRef<Message | null>(null);
  // ─── Chat plugin platform (Step 4 mechanics, Step 6 injection) ───
  // One registry PER MOUNT (plan H4: ChatRailShell mounts KodyChat twice;
  // plugin manifests are global pure data, instantiation is per mount).
  // The persistent rail changes plugin composition when navigating between
  // personal and repository pages. Rebuild the registry when that configuration
  // changes, without remounting chat or clearing its conversation and draft.
  // KodyChat owns ONLY the registration mechanics; the HOST surface passes
  // its plugin list (Step 6 / M6 — per-surface imports, so /client sheds
  // admin plugin code): ChatRailShell registers terminal + commands + vibe,
  // ClientChatSurface
  // registers branding + commands under its minimal grant. Registration
  // order = array order (theme/slot merge order); middleware ordering is
  // registry-sorted by `order` regardless.
  // With no plugins at all the registry is inert: slots render nothing and
  // the send-middleware chain passes through.
  const pluginRegistry = useMemo(() => {
    const registry = createChatPluginRegistry();
    const grant = capabilityGrant ?? FULL_GRANT;
    for (const entry of plugins ?? []) {
      registry.register(entry.plugin, grant);
      trace({ kind: "plugin:register", detail: entry.plugin.id });
    }
    return registry;
  }, [plugins, capabilityGrant]);
  // Terminal-intent hand-off: the terminal plugin's send middleware
  // dispatches this effect SYNCHRONOUSLY during runSendMiddleware, so
  // sendMessage reads the ref right after the chain returns.
  const pendingTerminalIntentRef = useRef<TerminalIntentEffectPayload | null>(
    null,
  );
  const consumePendingTerminalIntent =
    useCallback((): TerminalIntentEffectPayload | null => {
      const intent = pendingTerminalIntentRef.current;
      pendingTerminalIntentRef.current = null;
      return intent;
    }, []);
  // Slash-expansion hand-off (Step 5b): same synchronous ref pattern —
  // the commands plugin's middleware dispatches the expansion effect
  // during runSendMiddleware; sendMessage reads the raw typed text for
  // the user bubble right after the chain returns.
  const pendingSlashExpansionRef = useRef<SlashExpansionEffectPayload | null>(
    null,
  );
  const consumePendingSlashExpansion =
    useCallback((): SlashExpansionEffectPayload | null => {
      const expansion = pendingSlashExpansionRef.current;
      pendingSlashExpansionRef.current = null;
      return expansion;
    }, []);
  // Host-effect switch. Plugins dispatch effects (scope changes, navigation
  // requests) here — unknown kinds are ignored by design.
  const handlePluginHostEffect = useCallback((effect: ChatHostEffect) => {
    trace({ kind: "host-effect", detail: effect.kind });
    const terminalIntent = readTerminalIntentEffect(effect);
    if (terminalIntent) {
      pendingTerminalIntentRef.current = terminalIntent;
      return;
    }
    const slashExpansion = readSlashExpansionEffect(effect);
    if (slashExpansion) {
      pendingSlashExpansionRef.current = slashExpansion;
      return;
    }
    switch (effect.kind) {
      default:
        break;
    }
  }, []);
  useEffect(() => {
    const unsubscribe = pluginRegistry.onHostEffect(handlePluginHostEffect);
    return () => {
      unsubscribe();
    };
  }, [pluginRegistry, handlePluginHostEffect]);
  // Reactive: re-derives whenever the auth context updates `brain`. Without
  // useAuth this stayed stale because KodyChat lives in the persistent rail
  // and never remounts after Settings saves a Brain config — the dropdown
  // entry wouldn't appear until a full page reload.
  const { auth } = useAuth();
  const effectiveActorLogin = actorLogin ?? auth?.user.login ?? null;
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Slash command list (builtins + backend `commands/*.md`).
  // Stale-while-revalidate keeps autocomplete instant; the API itself
  // is cached on the server side via the GitHub client.
  const { commands: slashCommands } = useSlashCommands(auth);
  // Brain visibility is driven exclusively by the per-user Settings entry
  // (URL + API key in localStorage). A server-wide `BRAIN_CHAT_URL` env on
  // the deployment used to also surface the row, but that meant every
  // user of the deployment saw "Kody Brain" whether they'd configured it
  // or not — confusing, and pickable into a 401 loop. Settings is now the
  // single source of truth for whether the row appears.
  const brainConfigured = Boolean(auth?.brain?.url && auth?.brain?.apiKey);
  // Mount-time data loads (phase 1.6c: kody-chat-data.ts) — the chat model
  // list, the Repo Brain chat toggle, and the FLY_API_TOKEN vault probe.
  const {
    chatModels,
    chatModelsLoaded,
    automatic,
    brainModels,
    brainFlyChatEnabled,
    flyConfigured,
  } = useChatDataSources();

  // Use one session bucket for Vibe. The selected task is request context, not
  // a separate visible conversation; otherwise issue creation navigates to an
  // empty task chat and hides the message that created the issue.
  const desiredSessionScope: import("../chat/core/conversation/use-conversation-sessions").ChatSessionScope =
    vibeMode ? "vibe-default" : "global";
  // Commit scope changes only after they settle. A transient context flip
  // (parent re-render / task refetch momentarily dropping the selection)
  // would otherwise swap to the empty `vibe-default` conversation surface
  // and wipe the visible history until a manual refresh. A short settle
  // window absorbs flickers (they revert within the same tick) while real
  // user-driven task select/clear persists well past it.
  const [sessionStoreScope, setSessionStoreScope] =
    useState<
      import("../chat/core/conversation/use-conversation-sessions").ChatSessionScope
    >(desiredSessionScope);
  const directHeadersKey = JSON.stringify(kodyDirectHeaders ?? {});
  const conversationRequestHeaders = useMemo(
    () => ({
      ...buildAuthHeaders(auth),
      ...kodyDirectHeaders,
    }),
    // Keep the conversation client stable when the auth provider recreates an
    // equivalent object; replacing it rehydrates the session store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth?.owner, auth?.repo, auth?.token, auth?.user.login, directHeadersKey],
  );
  const sessionHook = useConversationSessions(
    sessionStoreScope,
    conversationRequestHeaders,
    effectiveActorLogin,
    effectiveActorLogin !== null,
    conversationId,
  );
  const routedConversationIdRef = useRef(conversationId);
  const routeSelectionPendingRef = useRef(false);
  const activeConversationId = sessionHook.activeSession?.id;
  const conversationSessions = sessionHook.sessions;
  const conversationsHydrated = sessionHook.hydrated;
  const switchConversation = sessionHook.switchSession;
  useEffect(() => {
    if (routedConversationIdRef.current === conversationId) return;
    routedConversationIdRef.current = conversationId;
    if (!conversationsHydrated || !conversationId) return;
    if (activeConversationId === conversationId) return;
    if (!conversationSessions.some((session) => session.id === conversationId))
      return;
    routeSelectionPendingRef.current = true;
    switchConversation(conversationId);
  }, [
    activeConversationId,
    conversationId,
    conversationSessions,
    conversationsHydrated,
    switchConversation,
  ]);
  useEffect(() => {
    if (!conversationsHydrated || !onConversationChange) return;
    if (routeSelectionPendingRef.current) {
      if (activeConversationId !== conversationId) return;
      routeSelectionPendingRef.current = false;
    }
    onConversationChange(activeConversationId ?? null);
  }, [
    activeConversationId,
    conversationId,
    conversationsHydrated,
    onConversationChange,
  ]);
  const { machineAccess, setMachineAccess } =
    useMachineAccessSelection(sessionHook);
  const localMachineAvailable = useLocalMachineAvailability(
    conversationRequestHeaders,
  );
  const createChatSession = sessionHook.createSession;
  const setChatSessionMessages = sessionHook.setSessionMessages;
  activateGuidedFlowSessionRef.current = sessionHook.switchSession;

  // Agent/model selection (phase 1.6c: kody-chat-selection.ts) — selected
  // agent/model state, dropdown entries, default resolution, family snap,
  // reasoning-effort wiring, and the per-session agent sync effect.
  const {
    selectionReady,
    selection: {
      agentId: selectedAgentId,
      modelId: selectedModelId,
      entry: currentEntry,
      agent: currentAgent,
      reasoning: currentReasoning,
      reasoningEffort: effectiveReasoningEffort,
    },
    selectEntry,
    agentMenuOpen,
    setAgentMenuOpen,
    setReasoningEffort,
    agentList,
  } = useAgentSelection({
    lockedAgentId: lockedAgentId ?? (lockedModelId ? "kody" : undefined),
    lockedModelId,
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
    chatModelsLoaded,
    automaticDefault: automatic.default === true,
    brainModels,
    sessionHook,
  });
  const [requestedSetupSection, setRequestedSetupSection] =
    useState<ChatSetupSection | null>(null);
  const createSelectedChatSession = useCallback(
    (options?: { machineAccess?: MachineAccess }) =>
      createChatSession({
        ...(sessionHook.hydrated && chatModelsLoaded && currentEntry?.key
          ? { agentKey: currentEntry.key }
          : {}),
        ...(options?.machineAccess
          ? { machineAccess: options.machineAccess }
          : {}),
      }),
    [
      chatModelsLoaded,
      createChatSession,
      currentEntry?.key,
      sessionHook.hydrated,
    ],
  );
  const createDefaultChatSession = useCallback(() => {
    const defaultEntry = resolveDefaultAgentEntry({
      chatModels,
      brainConfigured,
      agentList,
    });
    return createChatSession({
      ...(sessionHook.hydrated && chatModelsLoaded && defaultEntry?.key
        ? { agentKey: defaultEntry.key }
        : {}),
    });
  }, [
    agentList,
    brainConfigured,
    chatModelsLoaded,
    chatModels,
    createChatSession,
    sessionHook.hydrated,
  ]);
  createGuidedFlowSessionRef.current = createSelectedChatSession;

  // Read-only host snapshot handed to slot components and send middleware.
  // Minimal by design (plan H2 host-context channel) — grows per plugin
  // need, not speculatively. `slashCommands` feeds the commands plugin's
  // slash-expansion middleware (Step 5b). Manifests are static pure data,
  // so async-loaded lists travel via host context.
  const pluginHost = useMemo(
    () => ({ pathname, agentId: selectedAgentId, slashCommands }),
    [pathname, selectedAgentId, slashCommands],
  );
  const brainAbortRef = useRef<AbortController | null>(null);
  const brainAbortBySessionRef = useRef(new Map<string, AbortController>());
  // AbortController for the in-process chat path (`/api/kody/chat/kody`).
  // Without this the Stop button can't cancel the in-flight stream — the
  // model keeps generating, tokens keep flowing into the assistant bubble,
  // and the user has no recourse. Mirrors the Brain backend's pattern.
  const kodyAbortRef = useRef<AbortController | null>(null);
  const kodyAbortBySessionRef = useRef(new Map<string, AbortController>());
  // Preview-DOM auto-attach. The Kody Preview Inspector extension reports
  // the preview frame's URL/title/selection/DOM outline. The user-facing
  // toggle lives on the PreviewInspector toolbar (preview surfaces only);
  // this just reads the persisted flag at send time and silently injects
  // the snapshot when on. On non-preview tabs the extension's
  // collect-page resolves null and nothing is attached.
  const previewPicker = useElementPicker({ onSelect: () => {} });
  const previewPickerRef = useRef(previewPicker);
  previewPickerRef.current = previewPicker;
  const previewActionRunnerRef = useRef(previewActionRunner);
  previewActionRunnerRef.current = previewActionRunner;
  const previewContextRef = useRef<string | null>(null);
  previewContextRef.current = previewContext?.trim() || null;
  const AUTO_CONTEXT_KEY = "kody:preview-auto-context";
  const collectPreviewContextRef = useRef<() => Promise<string | null>>(
    async () => null,
  );
  collectPreviewContextRef.current = async () => {
    // Read the persisted flag fresh each send — the toggle lives on the
    // preview toolbar in another component tree, so we can't subscribe to
    // its state directly. Default ON when unset.
    let enabled = true;
    try {
      const v = window.localStorage.getItem(AUTO_CONTEXT_KEY);
      enabled = v === null ? true : v === "1";
    } catch {
      /* keep default */
    }
    if (!enabled) return null;
    const parts: string[] = [];
    if (previewContextRef.current) parts.push(previewContextRef.current);
    const liveRunner =
      getViewsPreviewActionRunner() ??
      getPreviewActionRunner?.() ??
      previewActionRunnerRef.current ??
      null;
    if (liveRunner) {
      try {
        const livePage = await liveRunner({ op: "wait", ms: 0 });
        if (livePage.info) parts.push(formatPageInfo(livePage.info));
      } catch {
        // Saved View context remains usable when the live browser disconnects.
      }
    }
    if (!previewPickerRef.current.available) {
      return parts.length > 0 ? parts.join("\n\n") : null;
    }
    try {
      const info = await previewPickerRef.current.collectPage(300);
      if (!info) return parts.length > 0 ? parts.join("\n\n") : null;
      // Append the saved-macros catalog so the model can offer to run them
      // when the user mentions one by name ("run my Login macro"). Macros
      // now live in the backend (macros.json), so fetch per-send — newly
      // saved macros are visible immediately, and it works across devices.
      parts.push(formatPageInfo(info));
      try {
        const res = await fetch("/api/kody/macros", { headers: authHeaders() });
        if (res.ok) {
          const data = (await res.json()) as { macros?: Macro[] };
          const macrosBlock = formatMacrosCatalog(data.macros ?? []);
          if (macrosBlock) parts.push(macrosBlock);
        }
      } catch {
        /* best-effort: macros catalog is optional context */
      }
      return parts.join("\n\n");
    } catch {
      return parts.length > 0 ? parts.join("\n\n") : null;
    }
  };
  // Depth counter for chained `preview_act` calls. The dashboard auto-feeds
  // each post-action DOM snapshot back to the model as a hidden user turn so
  // it can chain steps; this ref caps the chain so a runaway model can't
  // loop forever. Reset on every real user send (sendMessage).
  const previewActChainRef = useRef(0);
  const MAX_PREVIEW_ACT_CHAIN = 8;
  // Deferred handle to the send pipeline (type owned by kody-chat-send.ts).
  const sendTextRef = useRef<SendTextFn | null>(null);
  // Voice orchestration (phase 1.6c: kody-chat-voice.ts) — overlay/mute
  // state, the Piper voice preference, and the voice→sendText→TTS glue.
  // Reads the send pipeline through `sendTextRef` (bound each render right
  // after `sendText` is declared below), so it can mount before it.
  const {
    voiceChat,
    voiceMuted,
    setVoiceMuted,
    voiceOverlayOpen,
    setVoiceOverlayOpen,
    voiceId,
    handleSelectVoice,
    handleVoiceToggleMute,
  } = useVoiceOrchestration({ sendTextRef });
  // Initialized lazily below — `sendText` is declared further down.
  const runPreviewActionFromDirective = useCallback(
    async (directive: PreviewActDirective) => {
      if (directive.capabilitySlug && !isViewsPath(pathnameRef.current)) {
        try {
          stagePendingViewsCapabilityAction(directive, window.sessionStorage);
          router.push(auth ? repoScopedHref(auth, "/preview") : "/preview");
          return;
        } catch {
          // Continue with the in-memory handoff when session storage is blocked.
        }
      }
      const currentPreviewActionRunner = () =>
        getViewsPreviewActionRunner() ??
        getPreviewActionRunner?.() ??
        previewActionRunnerRef.current ??
        null;
      await runPreviewAction(directive, {
        prepareSurface: (action) =>
          ensureViewsOwnedCapabilityAction({
            action,
            pathname: pathnameRef.current,
            openViews: () =>
              router.push(auth ? repoScopedHref(auth, "/preview") : "/preview"),
            remoteBrowserAvailable: () => currentPreviewActionRunner() != null,
          }),
        actionRuntimeAvailable: () =>
          currentPreviewActionRunner() != null ||
          previewPickerRef.current.available,
        act: (action) => {
          const remoteRunner = currentPreviewActionRunner();
          return remoteRunner
            ? remoteRunner(action)
            : previewPickerRef.current.act(action);
        },
        sendText: async (content, _atts, opts) => {
          const send = sendTextRef.current;
          if (!send) return null;
          return send(content, [], opts);
        },
        toastSuccess: (m) => toast.success(m),
        toastError: (m) => toast.error(m),
        getChainDepth: () => previewActChainRef.current,
        incrementChainDepth: () => {
          previewActChainRef.current += 1;
        },
        maxAutoActions: MAX_PREVIEW_ACT_CHAIN,
      });
    },
    [auth, getPreviewActionRunner, router],
  );
  useEffect(() => {
    if (!isSelectedViewPath(pathname)) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (cancelled) return;
        const runner =
          getViewsPreviewActionRunner() ??
          getPreviewActionRunner?.() ??
          previewActionRunnerRef.current ??
          null;
        if (runner) {
          const directive = consumePendingViewsCapabilityAction(
            window.sessionStorage,
          );
          if (directive) await runPreviewActionFromDirective(directive);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getPreviewActionRunner, pathname, runPreviewActionFromDirective]);
  const runDashboardNavigateFromDirective = useCallback(
    (directive: DashboardNavigateDirective) => {
      const targetHref = addGuidedFlowFilePickerReturnHref(
        directive.href,
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      const href = auth ? repoScopedHref(auth, targetHref) : targetHref;
      router.push(href);
      toast.success(`Opened ${directive.label}`);
    },
    [auth, router],
  );
  const { data: repoAgents = [] } = useAgents();
  const { setSessionAgencyAgent } = sessionHook;
  const [agencyAgentSwitching, setAgencyAgentSwitching] = useState(false);
  const selectedAgencyAgentSlug =
    sessionHook.activeSession?.agencyAgent?.slug ?? "kody";
  const repoAgentSlugs = useMemo(
    () => repoAgents.map((agent) => agent.slug),
    [repoAgents],
  );
  const filteredAgentMentions = useMemo(() => {
    if (!agentMentionTrigger) return [];
    return repoAgents
      .filter((agent) =>
        agent.slug.toLowerCase().includes(agentMentionTrigger.query),
      )
      .slice(0, 6);
  }, [agentMentionTrigger, repoAgents]);
  const selectAgencyAgent = useCallback(
    async (nextSlug: string) => {
      if (nextSlug === selectedAgencyAgentSlug) return;
      const listedAgent = repoAgents.find(
        (candidate) => candidate.slug === nextSlug,
      );
      setAgencyAgentSwitching(true);
      try {
        const resolvedAgent =
          nextSlug === "kody"
            ? { slug: "kody", title: "Kody" }
            : await kodyApi.agent.get(nextSlug);
        const activeSessionId =
          sessionHook.activeSession?.id ?? createSelectedChatSession();
        setSessionAgencyAgent(activeSessionId, {
          slug: resolvedAgent.slug,
          title: resolvedAgent.title,
        });
      } catch {
        toast.error(`Could not switch to ${listedAgent?.title ?? nextSlug}`, {
          description: "The agent is not available for this repository.",
        });
      } finally {
        setAgencyAgentSwitching(false);
      }
    },
    [
      repoAgents,
      selectedAgencyAgentSlug,
      sessionHook.activeSession?.id,
      createSelectedChatSession,
      setSessionAgencyAgent,
    ],
  );
  // Generic switch-agent auto-kickoff queue lives in the live-session reducer.
  // Vibe execution does not use this path; it is owned by the Vibe page's
  // `/api/kody/vibe/execute` workflow.

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showIssueReport, setShowIssueReport] = useState(false);
  const [issueReportState, setIssueReportState] =
    useState<ChatIssueReportState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The vibe issue this chat JUST created (set in the issue-creation transfer
  // below). Used to scope the immediately-following turns to that issue while
  // the page's task scope (context.kind === "task") catches up — without it,
  // the turn right after creation carries no issue and the server can't bind
  // the runner hand-off to the right one. See chat/plugins/vibe/recent-issue.ts.
  const recentVibeIssueRef = useRef<RecentVibeIssue | null>(null);

  // Remote dev status (only polls when actorLogin is provided)
  const { data: remoteStatus } = useRemoteStatus(effectiveActorLogin);

  // Session sidebar state (for session management feature)
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);
  const [sessionSidebarReady, setSessionSidebarReady] = useState(false);
  useEffect(() => setSessionSidebarReady(true), []);
  const previousRailFullscreenRef = useRef(railFullscreen);
  const [sessionSidebarPinned, setSessionSidebarPinned] = useState(() => {
    if (!allowSessionSidebarPin) return false;
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem("kody-chat:sessions-panel-pinned") === "1"
    );
  });
  useEffect(() => {
    const wasRailFullscreen = previousRailFullscreenRef.current;
    previousRailFullscreenRef.current = railFullscreen;

    if (wasRailFullscreen && !railFullscreen) {
      setShowSessionSidebar(false);
    }
  }, [railFullscreen]);
  useEffect(() => {
    if (!allowSessionSidebarPin) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "kody-chat:sessions-panel-pinned",
      sessionSidebarPinned ? "1" : "0",
    );
    if (sessionSidebarPinned && isDesktop) setShowSessionSidebar(true);
  }, [allowSessionSidebarPin, isDesktop, sessionSidebarPinned]);

  // Reset the visible stream state on agent switch. Session switches are
  // intentionally allowed while a reply is running; each send now writes
  // back to the session id it started from.
  const activeSessionIdForReset = sessionHook.activeSession?.id ?? null;
  // Terminal HOST wiring (phase 1.6d) — registry, checkpoint load/save,
  // payload hand-off, chrome state and the lazy terminal chrome nodes all
  // live in useTerminalHost (kody-chat-terminal-host.tsx).
  const {
    chatMode,
    modeBySessionId: terminalModeBySessionId,
    sendInputToTerminal,
    sendKodyTerminalPayloadToTerminal,
    terminalSendBusy,
    terminalSendDisabled,
    terminalInputLabel,
    chatModeToggle,
    terminalBottomControls,
    terminalSurfaces,
  } = useTerminalHost({
    actorLogin: effectiveActorLogin,
    vibeMode,
    hideTerminalMode,
    lockedAgentId,
    pluginRegistry,
    activeSessionIdForReset,
    createChatSession: createSelectedChatSession,
    sessions: sessionHook.sessions,
    sessionsHydrated: sessionHook.hydrated,
    sessionStoreScope,
    input,
    setInput,
    setSlashMenuOpen,
    setSlashSelectedIndex,
    composerTextareaRef,
    setContextChips,
  });

  const applyChatEntry = useCallback(
    (entry: (typeof agentList)[number]) => {
      const compatibleMachineAccess = machineAccessForEntrySelection(
        entry,
        machineAccess,
      );
      if (compatibleMachineAccess !== machineAccess) {
        setMachineAccess(compatibleMachineAccess);
      }
      selectEntry(entry);
    },
    [machineAccess, selectEntry, setMachineAccess],
  );
  const selectChatEntry = useCallback(
    (entry: (typeof agentList)[number]) => {
      applyChatEntry(entry);
      setAgentMenuOpen(false);
    },
    [applyChatEntry, setAgentMenuOpen],
  );
  const selectMachineAccess = useCallback(
    (next: MachineAccess) => {
      const compatibleEntries = modelEntriesForMachineAccess(agentList, next);
      const currentIsCompatible = compatibleEntries.some(
        (entry) =>
          entry.agentId === selectedAgentId &&
          (entry.modelId ?? null) === selectedModelId,
      );
      if (!currentIsCompatible) {
        toast.error("The selected model does not support that machine access.");
        return;
      }
      setMachineAccess(next);
    },
    [agentList, selectedAgentId, selectedModelId, setMachineAccess],
  );
  // Client trace: record display-mode flips (ai ↔ terminal). Inspection
  // only — no behavior change (trace never throws, never logs).
  useEffect(() => {
    trace({ kind: "display-mode", detail: chatMode });
  }, [chatMode]);
  useEffect(() => {
    if (desiredSessionScope === sessionStoreScope) return;
    const t = setTimeout(() => setSessionStoreScope(desiredSessionScope), 150);
    return () => clearTimeout(t);
  }, [desiredSessionScope, sessionStoreScope]);

  // Poll action state — detects when Kody is waiting for instructions
  const { state: actionState, isWaiting: isKodyWaiting } = useKodyActionState(
    selectedTask?.id,
  );

  // Mode discriminator. Used to drive per-turn system-prompt scope blocks
  // (## Current task / ## Current capability / ## Current
  // report) and the context bar in the chat header. The thread itself is
  // the unified global store — these flags do NOT change which messages
  // render or which store receives writes.
  const isTaskMode = !!selectedTask;
  const isCapabilityMode = !!selectedCapability;
  const isGlobalMode = !isTaskMode && !isCapabilityMode;

  useEffect(() => {
    if (autoOpenSessionSidebar && railFullscreen && isGlobalMode) {
      setShowSessionSidebar(true);
    }
  }, [autoOpenSessionSidebar, railFullscreen, isGlobalMode]);

  // All chat messages live in the global session store. The sessionHook
  // owns a single `messages` list per active session; the page/scope
  // (task, capability, report) flows through the per-turn system
  // prompt, not a separate message store.
  const capabilitySlug: string | null = selectedCapability?.slug ?? null;
  const messages: Message[] = sessionHook.messages.map(chatToMessage);
  const activeChatSessionId = sessionHook.activeSession?.id;
  activeGuidedFlowSessionIdRef.current = activeChatSessionId ?? null;
  useEffect(() => {
    setActiveWidgetConversationId(activeChatSessionId ?? null);
  }, [activeChatSessionId]);

  useEffect(() => {
    if (!activeChatSessionId || !pendingGuidedFlowMessageRef.current) return;
    persistGuidedFlowMessageRef.current(
      activeChatSessionId,
      pendingGuidedFlowMessageRef.current,
    );
    pendingGuidedFlowMessageRef.current = null;
  }, [activeChatSessionId]);

  useEffect(() => {
    if (guidedFlowRequest) {
      setResumedGuidedFlowMessage(null);
      return;
    }
    if (
      !shouldAutoResumeGuidedFlows({
        hydrated: sessionHook.hydrated,
        activeSessionId: activeChatSessionId,
        lockedAgentSlug,
        messageCount: messages.length,
        guidedFlowRequest,
      })
    ) {
      if (lockedAgentSlug || messages.length > 0) {
        setResumedGuidedFlowMessage((current) =>
          current?.message.view?.rendererSlug === "guided-flow-status"
            ? null
            : current,
        );
      }
      return;
    }
    const activeSessionId = activeChatSessionId;
    if (!activeSessionId) return;
    setOpeningStatusCheckedSessionId(null);

    const initialParams = new URLSearchParams(window.location.search);
    if (
      initialParams.get("guidedFlowInstanceId") ||
      initialParams.get("guidedFlow")
    ) {
      return;
    }

    let cancelled = false;
    void fetch("/api/kody/guided-flows?status=active", {
      headers: authHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          flows?: Array<{
            view?: unknown;
            compatibility?: {
              status?: unknown;
              code?: unknown;
              message?: unknown;
            };
            instance?: {
              instanceId?: unknown;
              revision?: unknown;
              status?: unknown;
            };
            flow?: {
              title?: unknown;
              stepIndex?: unknown;
              stepCount?: unknown;
            };
          }>;
        };
      })
      .then((payload) => {
        if (cancelled) return;
        const flows = (payload?.flows ?? []).flatMap((candidate) => {
          const instance = candidate.instance;
          const flow = candidate.flow;
          if (
            typeof instance?.instanceId !== "string" ||
            typeof instance.revision !== "number" ||
            instance.status !== "active" ||
            typeof flow?.title !== "string" ||
            typeof flow.stepIndex !== "number" ||
            typeof flow.stepCount !== "number"
          ) {
            return [];
          }
          const compatibility =
            candidate.compatibility?.status === "incompatible" &&
            typeof candidate.compatibility.code === "string" &&
            typeof candidate.compatibility.message === "string"
              ? {
                  status: "incompatible" as const,
                  code: candidate.compatibility.code as
                    | "step_unavailable"
                    | "renderer_unavailable"
                    | "renderer_version_unpinned"
                    | "renderer_version_mismatch"
                    | "renderer_data_invalid",
                  message: candidate.compatibility.message,
                }
              : candidate.compatibility?.status === "compatible" ||
                  isRenderedViewDirective(candidate.view)
                ? ({ status: "compatible" } as const)
                : null;
          return compatibility
            ? [
                {
                  instance: {
                    instanceId: instance.instanceId,
                    revision: instance.revision,
                    status: "active" as const,
                  },
                  flow: {
                    title: flow.title,
                    stepIndex: flow.stepIndex,
                    stepCount: flow.stepCount,
                  },
                  compatibility,
                },
              ]
            : [];
        });
        setOpeningStatusCheckedSessionId(activeSessionId);
        const resumableFlows = flows.filter(
          (candidate) => candidate.compatibility.status === "compatible",
        );
        if (resumableFlows.length === 0) return;
        setResumedGuidedFlowMessage((current) => {
          if (
            current?.sessionId === activeSessionId &&
            current.message.view?.rendererSlug !== "guided-flow-status"
          ) {
            return current;
          }
          return {
            sessionId: activeSessionId,
            message: {
              role: "assistant",
              content: "",
              timestamp: new Date().toISOString(),
              view: buildGuidedFlowResumeView({
                sessionId: activeSessionId,
                flows: resumableFlows,
                additionalActions: [
                  {
                    ...PROJECT_ASSESSMENT_OPENING_ACTION,
                    variant: "secondary",
                  },
                  ...openingActions,
                ],
              }),
            },
          };
        });
      })
      .catch(() => {
        // Resume is an enhancement; an unavailable endpoint must not break chat.
        if (!cancelled) setOpeningStatusCheckedSessionId(activeSessionId);
      });

    return () => {
      cancelled = true;
    };
  }, [
    lockedAgentSlug,
    messages.length,
    activeChatSessionId,
    guidedFlowRequest,
    sessionHook.hydrated,
    openingActions,
  ]);

  useEffect(() => {
    if (!sessionHook.hydrated) return;
    if (guidedFlowRequest) return;
    if (lockedAgentSlug) return;
    const params = new URLSearchParams(window.location.search);
    const flowId = params.get("guidedFlow");
    const guidedFlowInstanceId = params.get("guidedFlowInstanceId");
    const instanceKey = params.get("instanceKey") ?? undefined;
    if (!flowId && !guidedFlowInstanceId) return;
    if (!activeChatSessionId) {
      createSelectedChatSession();
      return;
    }

    const locationAfterLaunch = locationAfterGuidedFlowLaunch(
      window.location.pathname,
      window.location.search,
    );
    let cancelled = false;
    const request = guidedFlowInstanceId
      ? fetch(
          `/api/kody/guided-flows?instanceId=${encodeURIComponent(guidedFlowInstanceId)}`,
          { headers: authHeaders() },
        )
      : fetch("/api/kody/guided-flows", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action: "start", flowId, instanceKey }),
        });
    void request
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          view?: unknown;
          instance?: unknown;
          flow?: { view?: unknown };
        };
      })
      .then((payload) => {
        const view = payload?.flow?.view ?? payload?.view;
        if (cancelled || !isRenderedViewDirective(view)) return;
        if (
          locationAfterLaunch !==
          `${window.location.pathname}${window.location.search}`
        ) {
          router.replace(locationAfterLaunch, { scroll: false });
        }
        persistGuidedFlowMessageRef.current(activeChatSessionId, {
          role: "assistant",
          content: guidedFlowInstanceId
            ? "GuidedFlow resumed. Continue where you stopped."
            : "GuidedFlow started. Follow the steps below.",
          timestamp: new Date().toISOString(),
          view,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    activeChatSessionId,
    createSelectedChatSession,
    guidedFlowRequest,
    lockedAgentSlug,
    pathname,
    router,
    sessionHook.hydrated,
  ]);

  const resumedGuidedFlowMessageIsPersisted =
    resumedGuidedFlowMessage?.message.view !== undefined &&
    messages.some(
      (message) =>
        message.view?.id === resumedGuidedFlowMessage.message.view?.id,
    );
  const resumedGuidedFlowDisplayMessage =
    resumedGuidedFlowMessage !== null &&
    resumedGuidedFlowMessage.sessionId === activeChatSessionId &&
    !resumedGuidedFlowMessageIsPersisted
      ? resumedGuidedFlowMessage.message
      : null;
  const chatOpeningMessage: Message | null =
    sessionHook.hydrated &&
    messages.length === 0 &&
    !lockedAgentSlug &&
    (!activeChatSessionId ||
      openingStatusCheckedSessionId === activeChatSessionId)
      ? {
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          view: buildRepositoryChatOpeningView(
            activeChatSessionId ?? "new-conversation",
            openingActions,
            {
              scope: auth?.owner && auth.repo ? "repository" : "personal",
            },
          ),
        }
      : null;
  const openingMessage = resumedGuidedFlowDisplayMessage ?? chatOpeningMessage;
  const displayMessages = openingMessage
    ? [...messages, openingMessage]
    : messages;

  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      sessionHook.setMessages((prevChat: ChatMessage[]) => {
        const newMessages =
          typeof updater === "function"
            ? updater(prevChat.map(chatToMessage))
            : updater;
        return newMessages.map(messageToChat);
      });
    },
    [sessionHook],
  );
  const setMessagesForSession = useCallback(
    (
      sessionId: string,
      updater: Message[] | ((prev: Message[]) => Message[]),
      options?: { persist?: boolean },
    ) => {
      setChatSessionMessages(
        sessionId,
        (prevChat: ChatMessage[]) => {
          const newMessages =
            typeof updater === "function"
              ? updater(prevChat.map(chatToMessage))
              : updater;
          return newMessages.map(messageToChat);
        },
        options,
      );
    },
    [setChatSessionMessages],
  );
  useGuidedFlowCommandCompletion({ messages, setMessages });
  useEffect(() => {
    const openWidget = (request: WidgetOpenRequest) => {
      const sessionId = request.conversationId ?? createSelectedChatSession();
      const view = buildWidgetPreviewView(
        request.widgetSlug,
        `widget-preview:${request.widgetSlug}:${crypto.randomUUID()}`,
      );
      if (!view) return;
      setMessagesForSession(sessionId, (previous) => [
        ...previous,
        {
          role: "assistant",
          content: "Widget opened.",
          timestamp: new Date().toISOString(),
          view,
        },
      ]);
    };
    const handleWidgetOpen = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isWidgetOpenRequest(detail)) return;
      consumeWidgetOpenRequest();
      openWidget(detail);
    };

    window.addEventListener(WIDGET_OPEN_EVENT, handleWidgetOpen);
    const pendingRequest = consumeWidgetOpenRequest();
    if (pendingRequest) openWidget(pendingRequest);
    return () =>
      window.removeEventListener(WIDGET_OPEN_EVENT, handleWidgetOpen);
  }, [createSelectedChatSession, setMessagesForSession]);
  persistGuidedFlowMessageRef.current = (sessionId, message) => {
    if (!sessionId) return;
    const viewKey = message.view
      ? `${sessionId}:${message.view.id}`
      : `${sessionId}:${message.timestamp}`;
    if (persistedGuidedFlowViewKeysRef.current.has(viewKey)) return;
    persistedGuidedFlowViewKeysRef.current.add(viewKey);
    const persistedMessage = {
      ...message,
      ...(guidedFlowMessageId(message)
        ? { id: guidedFlowMessageId(message) }
        : {}),
    };
    setMessagesForSession(sessionId, (previous) =>
      replaceGuidedFlowChatMessage(previous, persistedMessage),
    );
  };
  const activeLoading = messages.some((m) => m.isLoading);
  const { compactionStatus, setCompactionStatus } = useCompactionStatus(
    sessionHook.activeSession?.id,
  );

  // Kody Live runner lifecycle — reducer orchestration, event poll, SSE,
  // runner-state persistence + scope rehydration, and the zombie watchdog
  // all live in the useLiveRunner hook (extracted phase 1.6a; see
  // kody-chat-live-runner.ts). This component keeps the send paths, the
  // auto-kickoff firing effect below, and all UI wiring.
  const {
    liveState,
    dispatchLive,
    interactiveSessionIdRef,
    interactiveStateRef,
    currentScopeKeyRef,
    bootElapsed,
    eventSourceRef,
    connectSSE,
    startInteractiveSession,
    endInteractiveSession,
    restartInteractiveSession,
    rehydrateForScope,
  } = useLiveRunner({
    selectedAgentId,
    context,
    vibeMode,
    selectedTaskId: selectedTask?.id ?? null,
    capabilitySlug,
    activeSessionIdForReset,
    effectiveReasoningEffort,
    setLoading,
    setMessages,
    setMessagesForSession,
  });

  // Render aliases — kept named to minimise churn at JSX read sites.
  const interactiveState = liveState.phase;
  const interactiveTarget = liveState.target;
  const pendingKickoff = liveState.pendingKickoff;

  // Reset the visible stream state on agent switch. Session switches are
  // intentionally allowed while a reply is running; each send now writes
  // back to the session id it started from.
  const prevAgentIdRef = useRef<string>(selectedAgentId);
  useEffect(() => {
    const agentChanged = selectedAgentId !== prevAgentIdRef.current;
    prevAgentIdRef.current = selectedAgentId;

    if (agentChanged) {
      const sessionId = activeSessionIdForReset;
      if (sessionId) {
        brainAbortBySessionRef.current.get(sessionId)?.abort();
        kodyAbortBySessionRef.current.get(sessionId)?.abort();
      } else {
        brainAbortRef.current?.abort();
        kodyAbortRef.current?.abort();
      }
      eventSourceRef.current?.close();
      setLoading(false);
      setToolCalls([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionIdForReset, selectedAgentId]);

  const captureIssueReportState = useCallback((): ChatIssueReportState => {
    const visibleMessages = messages.filter((message) => !message.hidden);
    const recentMessages = visibleMessages.slice(-6).map((message) => ({
      role: message.role,
      text:
        reportValue(
          message.content ||
            (message.toolCalls?.length
              ? `[${message.toolCalls.length} tool call(s)]`
              : ""),
          1_200,
        ) ?? "[empty message]",
    }));
    const recentToolCalls = [
      ...visibleMessages.flatMap((message) => message.toolCalls ?? []),
      ...toolCalls,
    ]
      .slice(-8)
      .map((tool) => ({
        name: tool.name,
        status: tool.status,
        summary: reportValue(tool.result ?? tool.arguments, 800) ?? undefined,
      }));

    const pageItems = compactReportItems([
      reportItem("Page", currentPageRef.current),
      reportItem("Path", pathname),
      reportItem(
        "Repo",
        auth?.owner && auth?.repo ? `${auth.owner}/${auth.repo}` : null,
      ),
      reportItem("User", effectiveActorLogin),
    ]);

    const chatItems = compactReportItems([
      reportItem("Mode", chatMode),
      reportItem("Agent", currentAgent.name),
      reportItem("Selected model", selectedModelId),
      reportItem("Active loading", activeLoading ? "yes" : "no"),
      reportItem("Live runner", interactiveState),
      reportItem("Live target", interactiveTarget),
      reportItem("Live error", liveState.errorMessage, 500),
      reportItem("Session", sessionHook.activeSession?.id),
    ]);

    const contextItems = compactReportItems([
      reportItem(
        "Task",
        selectedTask
          ? `#${selectedTask.issueNumber} ${selectedTask.title}`
          : null,
        500,
      ),
      reportItem("Task column", selectedTask?.column),
      reportItem("Task pipeline", selectedTask?.pipeline?.state),
      reportItem("Capability", selectedCapability?.slug),
      reportItem("Report", selectedReport?.slug),
      reportItem("Org", selectedOrg?.org),
    ]);

    return {
      sections: [
        ...(pageItems.length ? [{ title: "Page", items: pageItems }] : []),
        ...(chatItems.length ? [{ title: "Chat", items: chatItems }] : []),
        ...(contextItems.length
          ? [{ title: "Selected context", items: contextItems }]
          : []),
      ],
      recentMessages,
      recentToolCalls,
    };
  }, [
    activeLoading,
    effectiveActorLogin,
    auth?.owner,
    auth?.repo,
    chatMode,
    currentAgent.name,
    interactiveState,
    interactiveTarget,
    liveState.errorMessage,
    messages,
    pathname,
    selectedCapability,
    selectedModelId,
    selectedOrg,
    selectedReport,
    selectedTask,
    sessionHook.activeSession?.id,
    toolCalls,
  ]);

  const openIssueReport = useCallback(() => {
    setIssueReportState(captureIssueReportState());
    setShowIssueReport(true);
  }, [captureIssueReportState]);

  useEffect(() => {
    onIssueReportReady?.(openIssueReport);
    return () => onIssueReportReady?.(null);
  }, [onIssueReportReady, openIssueReport]);

  // Unified thread: the canonical conversation store owns the
  // message list. Per-page scope (task / capability / report) flows
  // through the per-turn system-prompt blocks, not separate stores. The
  // "New conversation" button is the only way to reset the thread.

  const executeClearHistory = () => {
    // Unified thread: the global session store owns the messages. Clearing
    // is just `clearActiveSession()` regardless of scope (task / capability /
    // report); the per-scope system-prompt blocks keep their
    // context on the next turn.
    sessionHook.clearActiveSession();

    setToolCalls([]);

    // Drop the live engine session bound to this scope so the next message
    // starts a fresh runner instead of resuming the old one. rehydrate sees
    // no saved record now, closes SSE/poll, and resets live state to idle.
    const liveScope = currentScopeKeyRef.current;
    clearLiveSession(liveScope);
    rehydrateForScope(liveScope);
  };

  // Process incoming files (from picker or drag-and-drop). Reads each file,
  // uploads the blob to conversation storage and appends a composer chip.
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const conversationId = sessionHook.activeSession?.id;
    if (!conversationId) createSelectedChatSession();
    const newAttachments: Attachment[] = [];

    for (const file of list) {
      if (file.size > MAX_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 5MB.`);
        continue;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Persist the blob in canonical storage. The returned id is durable
        // and the message stores metadata rather than inline base64.
        let storedId: string;
        try {
          const ref = await putAttachment({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            blob: file,
            conversationId,
          });
          storedId = ref.id;
        } catch (error) {
          console.error("Attachment upload failed:", error);
          toast.error(`Could not attach ${file.name}`);
          continue;
        }

        newAttachments.push({
          id: storedId,
          name: file.name,
          type: file.type,
          size: file.size,
          data: dataUrl,
          mimeType: file.type,
        });
      } catch (err) {
        console.error("Failed to read file:", err);
        alert(`Failed to read file "${file.name}"`);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  // Handle file selection from the hidden <input type="file">
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await addFiles(files);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Drag-and-drop handlers on the chat container. We use a counter to
  // survive child-element dragenter/leave bubbling (otherwise the overlay
  // flickers as the cursor moves over inner nodes).
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await addFiles(files);
    }
  };

  // Paste handler: pull image/file blobs straight off the clipboard
  // (e.g. a screenshot copied to the clipboard, or "Copy image" from a
  // browser) and route them through the same addFiles pipeline as
  // drag-drop and the file picker. Only intercept when the clipboard
  // actually carries files — a plain text paste falls through to the
  // textarea's default behavior so typing/pasting text is unaffected.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    // Delete the pending or canonical blob because no message references it.
    deleteAttachment(id).catch((err) =>
      console.error("Attachment delete failed:", err),
    );
  };

  const sendText = useCallback<SendTextFn>(
    (messageContent, currentAttachments = [], options = {}) =>
      // Thin wrapper (phase 1.6b): the full per-backend turn pipeline
      // lives in kody-chat-send.ts. Deps are gathered fresh per call from
      // this memoized closure, so staleness semantics match the
      // pre-extraction inline body (same dependency array below).
      runSendText(
        {
          selectedAgentId,
          selectedModelId,
          effectiveReasoningEffort,
          selectedMachineAccess: machineAccess,
          selectedTask,
          capabilitySlug,
          selectedCapability,
          selectedOrg,
          selectedReport,
          selectedApp,
          onIssueCreated,
          vibeMode,
          context,
          actorLogin: effectiveActorLogin,
          repoAgentSlugs,
          selectedAgencyAgentSlug,
          agentList,
          lockedAgentSlug,
          kodyDirectHeaders,
          sessionHook,
          messages,
          setMessagesForSession,
          setLoading,
          setToolCalls,
          selectAgentEntry: applyChatEntry,
          setVoiceOverlayOpen,
          setCompactionStatus,
          currentPageRef,
          collectPreviewContextRef,
          recentVibeIssueRef,
          brainAbortRef,
          brainAbortBySessionRef,
          kodyAbortRef,
          kodyAbortBySessionRef,
          interactiveStateRef,
          interactiveSessionIdRef,
          startInteractiveSession,
          restartInteractiveSession,
          dispatchLive,
          connectSSE,
          runPreviewActionFromDirective,
          runDashboardNavigateFromDirective,
        },
        messageContent,
        currentAttachments,
        options,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedTask,
      selectedCapability,
      selectedApp,
      capabilitySlug,
      setMessagesForSession,
      messages,
      repoAgentSlugs,
      selectedAgencyAgentSlug,
      selectedAgentId,
      selectedModelId,
      effectiveReasoningEffort,
      machineAccess,
      applyChatEntry,
      lockedAgentSlug,
      kodyDirectHeaders,
      effectiveActorLogin,
      runDashboardNavigateFromDirective,
      sessionHook,
      connectSSE,
    ],
  );
  // Bind the deferred ref now that `sendText` exists. The preview-action
  // dispatcher (declared above to keep stream-handler closure stable) uses
  // this to push synthetic follow-up turns without forward-referencing
  // sendText itself.
  sendTextRef.current = sendText;

  const handleRenderedViewAction = useCallback(
    (view: RenderedViewDirective, action: RenderedViewAction) => {
      if (view.rendererSlug === "guided-flow-status") {
        if (onOpeningAction?.(action)) return;
        const guidedFlowId = action.result?.guidedFlowId;
        if (typeof guidedFlowId === "string" && guidedFlowId.trim()) {
          void openGuidedFlow({ flowId: guidedFlowId, message: "started" });
          return;
        } else if (action.id === PROJECT_ASSESSMENT_OPENING_ACTION.id) {
          void openGuidedFlow({
            flowId: PROJECT_ASSESSMENT_FLOW_ID,
            message: "started",
          });
          return;
        } else if (action.id === "resume") {
          const instanceId = action.result?.instanceId ?? view.data.instanceId;
          if (typeof instanceId === "string" && instanceId.trim()) {
            void openGuidedFlow({ instanceId, message: "resumed" }).then(
              (opened) => {
                if (opened) setResumedGuidedFlowMessage(null);
              },
            );
          }
          return;
        } else if (action.id === "cancel") {
          const instanceId = action.result?.instanceId;
          const expectedRevision = action.result?.expectedRevision;
          if (
            typeof instanceId === "string" &&
            typeof expectedRevision === "number"
          ) {
            void fetch("/api/kody/guided-flows", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeaders(),
              },
              body: JSON.stringify({
                action: "cancel",
                instanceId,
                expectedRevision,
                mutationId: `${view.id}:cancel:${instanceId}`,
              }),
            })
              .then(async (response) => {
                const payload = (await response.json().catch(() => null)) as {
                  error?: unknown;
                } | null;
                if (!response.ok) {
                  throw new Error(
                    typeof payload?.error === "string"
                      ? payload.error
                      : "guided_flow_action_failed",
                  );
                }
                setResumedGuidedFlowMessage(null);
              })
              .catch((error) => {
                toast.error(
                  guidedFlowActionErrorMessage(
                    error instanceof Error ? error.message : undefined,
                  ),
                );
              });
          }
          return;
        }
      }

      if (isModelOutputRecoveryView(view)) {
        if (usedViewIds.has(view.id)) return;
        if (action.id === MODEL_OUTPUT_RECOVERY_ACTION.chooseModel) {
          setUsedViewIds((previous) => new Set(previous).add(view.id));
          setRequestedSetupSection("model");
          setAgentMenuOpen(true);
          return;
        }
        if (action.id === MODEL_OUTPUT_RECOVERY_ACTION.cancel) {
          setUsedViewIds((previous) => new Set(previous).add(view.id));
          return;
        }
      }

      if (usedViewIds.has(view.id)) return;
      setUsedViewIds((prev) => {
        const next = new Set(prev);
        next.add(view.id);
        return next;
      });

      if (view.resultTarget === "guided-flow" && view.guidedFlow) {
        void (async () => {
          try {
            const guidedFlowChange = guidedFlowChangeForViewAction(action);
            const response = await fetch("/api/kody/guided-flows", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({
                ...guidedFlowChange,
                instanceId: view.guidedFlow?.instanceId,
                stepId: view.guidedFlow?.stepId,
                expectedRevision: view.guidedFlow?.revision,
                mutationId: view.id,
              }),
            });
            const payload = (await response.json()) as {
              view?: unknown;
              instance?: {
                instanceId?: string;
                status?: string;
                data?: Readonly<Record<string, unknown>>;
              };
              flow?: { id?: string };
              handoff?: {
                type?: string;
                message?: string;
                displayContent?: string;
              };
              navigation?: DashboardNavigateDirective;
              error?: string;
            };
            if (!response.ok) {
              throw new Error(payload.error ?? "GuidedFlow action failed");
            }

            setResumedGuidedFlowMessage(null);
            if (isRenderedViewDirective(payload.view)) {
              const nextView = payload.view;
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "Continue with the next step below.",
                  timestamp: new Date().toISOString(),
                  view: nextView,
                },
              ]);
            } else if (
              payload.handoff?.type === "kody" &&
              typeof payload.handoff.message === "string" &&
              payload.handoff.message.trim()
            ) {
              void sendText(payload.handoff.message, [], {
                displayContent:
                  typeof payload.handoff.displayContent === "string" &&
                  payload.handoff.displayContent.trim()
                    ? payload.handoff.displayContent
                    : "Request submitted.",
              });
            } else if (
              payload.instance?.status === "completed" &&
              payload.flow?.id === PROJECT_ASSESSMENT_FLOW_ID
            ) {
              void sendText(
                buildProjectAssessmentSubmission(
                  payload.instance.instanceId,
                  payload.instance.data,
                ),
                [],
                { displayContent: "Assessment answers submitted." },
              );
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content:
                    payload.instance?.status === "cancelled"
                      ? "GuidedFlow cancelled."
                      : "GuidedFlow completed.",
                  timestamp: new Date().toISOString(),
                },
              ]);
            }
            if (payload.navigation?.action === "dashboard_navigate") {
              runDashboardNavigateFromDirective(payload.navigation);
            }
          } catch (error) {
            setUsedViewIds((prev) => {
              const next = new Set(prev);
              next.delete(view.id);
              return next;
            });
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: guidedFlowActionErrorMessage(
                  error instanceof Error ? error.message : undefined,
                ),
                timestamp: new Date().toISOString(),
                isError: true,
              },
            ]);
          }
        })();
        return;
      }

      // Direct widget play is self-contained: the widget owns its replies and
      // completion must not start an unrelated model turn.
      if (isWidgetPreviewView(view)) return;

      const resultPayload = JSON.stringify({
        kind: "view_result",
        view: "renderer",
        viewId: view.id,
        rendererSlug: view.rendererSlug,
        actionId: action.id,
        ...(action.result ? { result: action.result } : {}),
      });
      void sendText(
        `${action.response}\n\n<view_result>${resultPayload}</view_result>`,
        [],
        {
          displayContent: action.result ? action.response : action.label,
        },
      );
    },
    [
      openGuidedFlow,
      onOpeningAction,
      runDashboardNavigateFromDirective,
      sendText,
      setAgentMenuOpen,
      setMessages,
      usedViewIds,
    ],
  );

  const handleWidgetEvent = useCallback(
    (view: RenderedViewDirective, event: WidgetHostEvent) => {
      if (usedViewIds.has(view.id)) return;
      if (event.type === "post-to-chat") {
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: `**${view.rendererName} widget**\n\n${event.content}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (event.type === "send-to-kody") {
        if (activeLoading) return;
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: `**${view.rendererName} widget asked Kody**\n\n${event.message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        void sendText(
          `The widget ${JSON.stringify(view.rendererSlug)} sent this message to Kody:\n\n${event.message}`,
          [],
          { hidden: true },
        );
        return;
      }

      const action: RenderedViewAction = {
        id: event.actionId,
        label: event.actionId,
        response: event.actionId,
        ...(event.data ? { result: event.data } : {}),
      };
      if (view.resultTarget === "guided-flow") {
        handleRenderedViewAction(view, action);
      } else {
        setMessages((previous) =>
          previous.map((message) =>
            message.view?.id === view.id
              ? {
                  ...message,
                  view: {
                    ...message.view,
                    result: {
                      actionId: event.actionId,
                      ...(event.data ? { data: event.data } : {}),
                      completedAt: new Date().toISOString(),
                    },
                  },
                }
              : message,
          ),
        );
        setUsedViewIds((previous) => new Set(previous).add(view.id));
      }
    },
    [
      activeLoading,
      handleRenderedViewAction,
      sendText,
      setMessages,
      usedViewIds,
    ],
  );

  // Generic switch-agent auto-kickoff. The switch handler stashes an
  // optional kickoff string in `pendingKickoff`; we wait here for the new
  // runner agent AND matching task scope to both land before firing.
  //
  // ORDERING NOTE — this useEffect MUST come after `rehydrateForScope`
  // above. When context first flips from null → task on a fresh issue,
  // rehydrate calls `stopInteractivePoll()` and resets the
  // interactive-session refs to idle/null. If the kickoff fired *first*
  // it would set state to 'booting' and start the poll, then rehydrate
  // would immediately kill the poll and zero the refs — symptom: the
  // Stop button stays stuck (loading=true forever, no chat.done can
  // arrive), composer stays disabled. Running rehydrate first means
  // the kickoff's startInteractiveSession sets up the poll AFTER the
  // reset, so events flow back normally.
  useEffect(() => {
    if (!pendingKickoff) return;
    const isRunner =
      selectedAgentId === "kody-live" || selectedAgentId === "kody-live-fly";
    if (!isRunner) return;
    if (context?.kind !== "task") return;
    // Issue-number gate. If the directive named a specific issue, only
    // fire once the task scope resolves to THAT issue. Otherwise the
    // kickoff goes out the moment we land on the previously-viewed task
    // (cached in tasks query) before the new issue appears in the list.
    if (
      pendingKickoff.issueNumber !== null &&
      context.task.issueNumber !== pendingKickoff.issueNumber
    ) {
      return;
    }
    const kickoffContent = pendingKickoff.content;
    dispatchLive({ type: "KICKOFF_FIRED" });
    void Promise.resolve().then(() => {
      void sendText(kickoffContent);
    });
  }, [pendingKickoff, selectedAgentId, context, sendText, dispatchLive]);

  const sendMessage = () =>
    // Thin wrapper (phase 1.6b): the composer submit path (/init, plugin
    // send-middleware, waiting-instruction route) lives in
    // kody-chat-send.ts. Re-built each render like the old inline
    // async function, so it always sees current composer state.
    runSendMessage({
      chatMode,
      input,
      attachments,
      contextChips,
      isKodyWaiting,
      selectedTask,
      setInput,
      setContextChips,
      setAttachments,
      setSlashMenuOpen,
      setSlashSelectedIndex,
      setAgentMentionTrigger,
      setMessages,
      pluginRegistry,
      pluginHost,
      handlePluginHostEffect,
      pendingTerminalIntentRef,
      pendingSlashExpansionRef,
      consumePendingTerminalIntent,
      consumePendingSlashExpansion,
      sendInputToTerminal,
      sendKodyTerminalPayloadToTerminal,
      previewActChainRef,
      sendText,
    });

  const handleStop = () => {
    // Cancel every backend the chat can be talking to. Each abort/close
    // is a no-op if that backend wasn't active — calling them all
    // unconditionally keeps the handler simple and the Stop button
    // honest regardless of which agent is selected.
    const activeSessionId = sessionHook.activeSession?.id ?? null;
    eventSourceRef.current?.close();
    if (activeSessionId) {
      kodyAbortBySessionRef.current.get(activeSessionId)?.abort();
      brainAbortBySessionRef.current.get(activeSessionId)?.abort();
    } else {
      kodyAbortRef.current?.abort();
      brainAbortRef.current?.abort();
    }
    const stoppedTurn = settleActiveAssistants(messages);
    setLoading(false);
    setMessages(stoppedTurn.messages);
    if (activeSessionId) {
      for (const message of stoppedTurn.settled) {
        if (!message.id) continue;
        const stored = messageToChat(message);
        void sessionHook
          .settlePendingAssistantMessage(activeSessionId, {
            ...stored,
            id: message.id,
            role: "assistant",
          })
          .catch(() => undefined);
      }
    }
  };

  // Composer key/slash/mention handlers (phase 1.6d) — extracted to the
  // useComposerHandlers hook (kody-chat-composer-handlers.ts). State stays
  // here; the hook owns only the handlers. Called after sendMessage /
  // handleStop-adjacent state so the closures see current values.
  const {
    refreshAgentMentionTrigger,
    handleComposerInputChange,
    applyAgentMentionSelection,
    applySlashSelection,
    closeComposerMenus,
    handleKeyDown,
  } = useComposerHandlers({
    chatMode,
    isDesktop,
    input,
    setInput,
    attachments,
    messages,
    activeLoading,
    composerTextareaRef,
    slashCommands,
    slashMenuOpen,
    setSlashMenuOpen,
    slashSelectedIndex,
    setSlashSelectedIndex,
    agentMentionTrigger,
    setAgentMentionTrigger,
    agentMentionSelectedIndex,
    setAgentMentionSelectedIndex,
    filteredAgentMentions,
    sendMessage,
    handleStop,
  });

  // Global ⌘/Ctrl+K toggles the sessions sidebar. Skips when a modifier-less
  // key would interfere with native browser shortcuts.
  useEffect(() => {
    if (!isGlobalMode) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSessionSidebar((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isGlobalMode]);

  // Hermes owns titles. The stream applies its session.title event to the sidebar.
  // A saved title is also read after a completed reply in case the event arrived late.
  const titledSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isGlobalMode || activeLoading) return;
    const session = sessionHook.activeSession;
    if (!session || session.title !== "New conversation") return;
    if (!messages.some((message) => message.role === "assistant" && message.content.trim())) return;
    if (titledSessionRef.current === session.id) return;
    titledSessionRef.current = session.id;
    void (async () => {
      try {
        const storedId = await sessionHook.resolveSessionId(session.id);
        const response = await fetch(`/api/kody/hermes/sessions/${encodeURIComponent(storedId)}`, {
          headers: kodyDirectHeaders ?? authHeaders(),
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json() as { session?: { title?: string } };
        const title = payload.session?.title?.trim();
        if (title && title !== "New conversation") sessionHook.renameSession(session.id, title);
      } catch { /* Hermes may provide a title later. */ }
    })();
  }, [isGlobalMode, activeLoading, messages, sessionHook, kodyDirectHeaders]);

  // Both `kody-live` (GH Actions) and `kody-live-fly` (Fly Machines) use
  // the same interactive session model, so they share this UI state.
  const isKodyLive =
    selectedAgentId === "kody-live" || selectedAgentId === "kody-live-fly";
  const checkpointThrough =
    sessionHook.activeSession?.contextCheckpoint?.throughMessageCount ?? 0;
  const canCompactConversation =
    messages.length - checkpointThrough > 2 && !activeLoading;
  const compactConversationNow = useCallback(async () => {
    const activeSession = sessionHook.activeSession;
    if (!activeSession || activeLoading) return;

    const result = await compactConversationForTurn({
      messages: messages.map(({ role, content }) => ({ role, content })),
      checkpoint: activeSession.contextCheckpoint,
      nextUserContent: "",
      force: true,
      recentTokens: 0,
      model: selectedModelId,
      headers: kodyDirectHeaders ?? authHeaders(),
      onStatus: setCompactionStatus,
      onCheckpoint: (checkpoint) =>
        sessionHook.setSessionCheckpoint(activeSession.id, checkpoint),
    });
    if (result.didCompact && isKodyLive) endInteractiveSession();
  }, [
    activeLoading,
    endInteractiveSession,
    isKodyLive,
    kodyDirectHeaders,
    messages,
    selectedModelId,
    sessionHook,
    setCompactionStatus,
  ]);
  const standalonePresentation = presentation === "standalone";

  // The composer's primary button switches role for Kody Live agents based
  // on whether there's input AND the current session state:
  //   has text          → 'send'  (auto-starts the runner if needed)
  //   empty + idle/end  → 'start' (warm up the runner)
  //   empty + booting   → 'cancel' (abandon the boot attempt)
  //   empty + ready     → 'stop'  (end the live session)
  // For non-Kody-Live agents the button is always 'send' (disabled if empty).
  const hasComposerContent =
    input.trim().length > 0 ||
    (chatMode === "ai" && (attachments.length > 0 || contextChips.length > 0));
  const richComposerEnabled =
    chatMode === "ai" && Boolean(railFullscreen) && isDesktop;
  // While a reply streams (activeLoading) the textarea stays ENABLED so the
  // user can type ahead; only sending is blocked (Enter is a newline and the
  // primary button is Stop). Kody Live still locks input until ready.
  const composerDisabled =
    chatMode === "ai" &&
    (!selectionReady ||
      agencyAgentSwitching ||
      (isKodyLive && interactiveState !== "ready"));
  const composerActionDisabled =
    chatMode === "ai" && (!selectionReady || agencyAgentSwitching);
  type ComposerAction = "send" | "start" | "stop" | "cancel";
  const composerAction: ComposerAction = !isKodyLive
    ? "send"
    : hasComposerContent
      ? "send"
      : interactiveState === "ready"
        ? "stop"
        : interactiveState === "booting"
          ? "cancel"
          : "start";

  // Generate placeholder based on mode. The generic (non-task/capability/draft)
  // case is page-aware: on any sidebar page, hint that Kody can answer about
  // that page — Kody knows every dashboard concept, not just capabilities/tasks.
  // `pageLabel` is derived once at the top of the component.
  const genericPlaceholder = pageLabel
    ? `Ask Kody about ${pageLabel}...`
    : `Ask Kody about any page, capability, or feature...`;
  const placeholder =
    chatMode === "terminal"
      ? "Send command to terminal..."
      : isKodyLive
        ? interactiveState === "idle" || interactiveState === "ended"
          ? "Click Start to warm up the runner."
          : interactiveState === "booting"
            ? selectedAgentId === "kody-live-fly"
              ? "Booting runner — ~45-60s on Fly..."
              : "Booting runner — ~90s on GitHub Actions..."
            : pageLabel
              ? `Ask Kody (live runner) about ${pageLabel}...`
              : "Ask Kody (live runner)..."
        : isKodyWaiting
          ? `Give Kody instructions...`
          : isTaskMode
            ? `Ask about task #${selectedTask?.issueNumber}...`
            : isCapabilityMode
              ? `Ask about capability \`${selectedCapability?.slug ?? ""}\`...`
              : genericPlaceholder;

  return (
    // Surface layout (Phase 1.6e): ChatSurfaceLayout owns the structural
    // JSX (plugin provider mount, drag chrome, waiting banner, footer
    // slot). Every region node below is built HERE so state, handlers,
    // and the per-session agent writes stay in this file.
    <ChatSurfaceLayout
      pluginRegistry={pluginRegistry}
      pluginHost={pluginHost}
      standalonePresentation={standalonePresentation}
      isDraggingFile={isDraggingFile}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sessionsPanel={
        <SessionsPanel
          open={showSessionSidebar}
          pinned={allowSessionSidebarPin && isDesktop && sessionSidebarPinned}
          railFullscreen={railFullscreen}
          standalonePresentation={standalonePresentation}
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          modeBySessionId={vibeMode ? undefined : terminalModeBySessionId}
          onSwitchSession={(id) => {
            setActiveWidgetConversationId(id);
            sessionHook.switchSession(id);
          }}
          onCreateSession={() => {
            setActiveWidgetConversationId(createDefaultChatSession());
          }}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          onTogglePinned={
            allowSessionSidebarPin && isDesktop
              ? () => setSessionSidebarPinned((prev) => !prev)
              : undefined
          }
          onClose={() => setShowSessionSidebar(false)}
        />
      }
      voiceOverlay={
        voiceOverlayOpen ? (
          <VoiceChatOverlay
            state={voiceChat.state}
            currentTranscript={voiceChat.currentTranscript}
            turnCount={voiceChat.turnCount}
            error={voiceChat.error}
            ttsEngine={voiceChat.ttsEngine}
            ttsError={voiceChat.ttsError}
            voiceId={voiceId}
            voices={PIPER_VOICES}
            onSelectVoice={handleSelectVoice}
            messages={messages}
            agentName={currentAgent.name}
            onStop={() => {
              voiceChat.stopConversation();
              setVoiceOverlayOpen(false);
              setVoiceMuted(false);
            }}
            onInterrupt={() => {
              voiceChat.interruptConversation();
            }}
            onToggleMute={handleVoiceToggleMute}
            isMuted={voiceMuted}
          />
        ) : null
      }
      header={
        // Header with context — extracted to chat/surface/HeaderControls.
        // Menu open/close state, selection state, and the per-session agent
        // pick stay here; the region is presentation-only.
        <HeaderControls
          currentEntry={currentEntry}
          currentAgent={currentAgent}
          lockedAgentId={lockedAgentId}
          hideAgentPicker={hideAgentPicker}
          showAgencyAgentPicker={allowAgencyAgentSelection}
          compact={compactHeader}
          agentMenuOpen={agentMenuOpen}
          setAgentMenuOpen={setAgentMenuOpen}
          requestedSetupSection={requestedSetupSection}
          onRequestedSetupSectionHandled={() => setRequestedSetupSection(null)}
          messageCount={messages.length}
          currentReasoning={currentReasoning}
          effectiveReasoningEffort={effectiveReasoningEffort}
          setReasoningEffort={setReasoningEffort}
          agentList={agentList}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
          agencyAgents={repoAgents}
          selectedAgencyAgentSlug={selectedAgencyAgentSlug}
          onSelectAgencyAgent={selectAgencyAgent}
          onSelectEntry={selectChatEntry}
          machineAccess={machineAccess}
          machineAvailability={{
            local:
              localMachineAvailable &&
              agentList.some((entry) => entry.agentId === "kody"),
            brain: agentList.some(
              (entry) =>
                entry.agentId === "brain" || entry.agentId === "brain-fly",
            ),
          }}
          onSelectMachine={selectMachineAccess}
          remoteStatus={remoteStatus}
          onNewConversation={() => {
            // A slow turn must not trap the user in the current conversation.
            // Stop the old stream before switching so its updates stay scoped
            // to the old session and the new composer is immediately usable.
            if (activeLoading) handleStop();
            setActiveWidgetConversationId(createDefaultChatSession());
            setToolCalls([]);
          }}
          hideNewConversation={showSessionSidebar}
          activeLoading={activeLoading}
          showSessionSidebar={showSessionSidebar}
          sessionSidebarReady={sessionSidebarReady}
          onToggleSessionSidebar={() =>
            setShowSessionSidebar((visible) => !visible)
          }
          onToggleFullscreen={onToggleFullscreen}
          railFullscreen={railFullscreen}
          onCollapseRail={onCollapseRail}
          onClose={onClose}
          isTaskMode={isTaskMode}
          selectedTask={selectedTask}
          isCapabilityMode={isCapabilityMode}
          activeSessionTitle={sessionHook.activeSession?.title}
        />
      }
      showKodyWaitingBanner={Boolean(isKodyWaiting && actionState)}
      kodyWaitingStep={actionState?.step}
      messageList={
        <>
          {sessionHook.persistenceError ? (
            <div
              role="alert"
              className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {sessionHook.persistenceError}
            </div>
          ) : null}
          <MessageList
            chatMode={chatMode}
            messages={displayMessages}
            setMessages={setMessages}
            onResend={(content) => {
              void sendText(content, []);
            }}
            onRetryAssessmentWriting={(turnId) => {
              void sendText("Retry report writing only", [], {
                retryAssessmentTurnId: turnId,
              });
            }}
            activeLoading={activeLoading}
            compactionStatus={compactionStatus}
            activeSessionId={sessionHook.activeSession?.id}
            toolCalls={toolCalls}
            usedViewIds={usedViewIds}
            onRenderedViewAction={handleRenderedViewAction}
            onWidgetEvent={handleWidgetEvent}
            roleLayout={messageRoleLayout}
            agentHandoffs={sessionHook.activeSession?.agentHandoffs}
            onInternalLinkClick={(href) => router.push(href)}
            emptyState={
              <EmptyState
                welcome={emptyStateWelcome}
                isTaskMode={isTaskMode}
                vibeMode={vibeMode}
                selectedTask={selectedTask}
                isCapabilityMode={isCapabilityMode}
                selectedCapability={selectedCapability}
              />
            }
            terminalSurfaces={terminalSurfaces}
          />
        </>
      }
      composer={
        // Composer — extracted to chat/surface/Composer (Step 3). All
        // state (input, slash menu, mentions, attachments, chips, voice)
        // and every handler stay here; the region is presentation-only.
        // The context-chip pills render the ChatRailApi `composerInjection`
        // contract fed through the effect above.
        <Composer
          chatMode={chatMode}
          activeLoading={activeLoading}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          contextChips={contextChips}
          onRemoveContextChip={removeContextChip}
          isKodyLive={isKodyLive}
          interactiveState={interactiveState}
          bootElapsed={bootElapsed}
          selectedAgentId={selectedAgentId}
          interactiveTarget={interactiveTarget}
          liveErrorMessage={liveState.errorMessage}
          onRestartLive={restartInteractiveSession}
          input={input}
          composerTextareaRef={composerTextareaRef}
          richComposerEnabled={richComposerEnabled}
          placeholder={placeholder}
          composerDisabled={composerDisabled}
          composerActionDisabled={composerActionDisabled}
          onInputChange={handleComposerInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCaretMove={refreshAgentMentionTrigger}
          onMenusClose={closeComposerMenus}
          slashCommandMenu={
            slashMenuOpen ? (
              <SlashCommandMenu
                commands={slashCommands}
                filter={parseSlashTrigger(input).filter}
                selectedIndex={slashSelectedIndex}
                onSelect={applySlashSelection}
                onHover={setSlashSelectedIndex}
              />
            ) : null
          }
          agentMentionsOpen={
            Boolean(agentMentionTrigger) && filteredAgentMentions.length > 0
          }
          agentMentions={filteredAgentMentions}
          agentMentionSelectedIndex={agentMentionSelectedIndex}
          onAgentMentionHover={setAgentMentionSelectedIndex}
          onAgentMentionSelect={applyAgentMentionSelection}
          composerAction={composerAction}
          hasComposerContent={hasComposerContent}
          terminalSendDisabled={terminalSendDisabled}
          terminalSendBusy={terminalSendBusy}
          terminalInputLabel={terminalInputLabel}
          onSend={sendMessage}
          onStop={handleStop}
          onEndLiveSession={endInteractiveSession}
          onStartLiveSession={startInteractiveSession}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          voiceActive={voiceOverlayOpen}
          voiceSupported={voiceChat.isSupported && currentAgent.supportsVoice}
          onVoiceTap={() => {
            // Handle tap based on current voice state:
            // - If AI is speaking: interrupt and start listening (voice interrupt)
            // - If listening/processing: stop conversation
            // - If idle: start conversation
            if (voiceChat.state === "speaking") {
              // Voice interrupt: cancel AI speech and start listening
              voiceChat.interruptConversation();
              setVoiceOverlayOpen(true);
              setVoiceMuted(false);
            } else if (voiceOverlayOpen) {
              // Already in voice mode - stop it
              voiceChat.stopConversation();
              setVoiceOverlayOpen(false);
              setVoiceMuted(false);
            } else {
              // Not in voice mode - start it
              voiceChat.startConversation();
              setVoiceOverlayOpen(true);
            }
          }}
          onVoiceLongPressStart={() => {
            voiceChat.startConversation();
            setVoiceOverlayOpen(true);
          }}
          onVoiceLongPressEnd={() => {
            /* let conversation handle it */
          }}
          messageCount={messages.length}
          canCompactConversation={canCompactConversation}
          compactionBusy={compactionStatus === "compacting"}
          onCompactConversation={compactConversationNow}
          onClearHistory={() => setShowClearConfirm(true)}
          terminalBottomControls={terminalBottomControls}
          chatModeToggle={chatModeToggle}
        />
      }
      dialogs={
        <>
          <ConfirmDialog
            open={showClearConfirm}
            title="Clear history"
            description="Clear conversation history? This cannot be undone."
            confirmLabel="Clear"
            variant="destructive"
            onConfirm={executeClearHistory}
            onClose={() => setShowClearConfirm(false)}
          />
          <ChatIssueReportDialog
            open={showIssueReport}
            onClose={() => setShowIssueReport(false)}
            capturedState={issueReportState}
          />
        </>
      }
    />
  );
}
