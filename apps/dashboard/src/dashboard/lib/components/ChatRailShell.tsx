/**
 * @fileType component
 * @domain layout
 * @pattern chat-rail-shell
 * @ai-summary Root-level chrome that hosts the dashboard's KodyChat. Pages
 *   render as `{children}` and push their chat context up via
 *   `useChatScope()`. KodyChat mounts TWICE: a persistent desktop instance
 *   (full pane on /chat, side rail elsewhere — hidden, not unmounted, so
 *   scroll position, streaming state, and message history persist across
 *   navigation) plus a second instance in the mobile sheet while it is
 *   open on non-chat routes. Anything host-fed (composerInjection,
 *   attachmentInjection, previewContext) reaches BOTH instances.
 *
 *   Chat is app-level and remains visible before a repository is connected;
 *   repository context only enables repository-backed tools. On mobile the desktop aside is
 *   replaced by a panel that opens below the top header (no backdrop), so
 *   the header's hamburger stays reachable; it's opened from the header's
 *   chat button.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { KodyChat } from "@kody-ade/kody-chat-dashboard/components/KodyChat";
import { AppHeader } from "./AppHeader";
import { ChatShell } from "@kody-ade/kody-chat-dashboard/components/ChatShell";
import {
  GuidedFlowChatProvider,
  useGuidedFlowChat,
} from "@kody-ade/kody-chat-dashboard/guided-flows/chat-controller";
import { WIDGET_OPEN_EVENT } from "@kody-ade/kody-chat-dashboard/widgets/chat-launch";
import { SidebarNotifications } from "./SidebarChrome";
import { useSidebarNavSections } from "./use-sidebar-nav-sections";
import { RepoManager } from "./RepoManager";
import { CommandPalette } from "./CommandPalette";
import { SettingsDrawerProvider } from "./SettingsDrawer";
import { NotificationsProvider } from "../notifications/NotificationsProvider";
import { useAuth } from "../auth-context";
import {
  clearBrowserRepositorySession,
  KodyAuthBridgeProvider,
} from "@kody-ade/kody-chat-dashboard/auth-context";
import { KodyThemeBridgeProvider } from "@kody-ade/kody-chat-dashboard/theme";
import { useTheme } from "../../providers/Theme";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useChatFirstLayout } from "../hooks/use-chat-first-layout";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { trace } from "@kody-ade/kody-chat-dashboard/platform";
import { kodyAuthClient } from "../auth/kody-auth-client";
import { Button } from "@kody-ade/base/ui/button";
import type { ChatContext } from "../chat-types";
import {
  legacyRepoRedirectPath,
  repoPathForNavMatching,
  repoScopedHref,
  resolveRepoRouteAuthSync,
} from "@kody-ade/base/routes";
import { routeOwnsAppHeader } from "./header-ownership";
// Leaf manifest import on purpose (Step 7 bundle check): the terminal
// barrel statically reaches ChatTerminalSurface/TerminalControls, which
// must only ever load through KodyChat's React.lazy chunks — a static path
// here would drag them into the shared sync chunks /client also loads.
import { terminalChatPlugin } from "@kody-ade/kody-chat-dashboard/plugins/terminal/plugin";
import { commandsChatPlugin } from "@kody-ade/kody-chat-dashboard/plugins/commands";
import { vibeChatPlugin } from "@kody-ade/kody-chat-dashboard/plugins/vibe";
import { tasksChatPlugin, TASKS_PANEL_ID } from "../chat/plugins/tasks";
// Phase 2 step 4 — remaining admin pages migrated to page-plugins via the
// tasks-pilot recipe (panels-only manifests; routes unchanged, so the
// chat-first toggle OFF stays byte-identical).
import {
  activityChatPlugin,
  ACTIVITY_PANEL_ID,
} from "../chat/plugins/activity";
import {
  agencyRunsChatPlugin,
  AGENCY_RUNS_PANEL_ID,
} from "../chat/plugins/agency-runs";
import { agentsChatPlugin, AGENTS_PANEL_ID } from "../chat/plugins/agents";
import {
  brandsChatPlugin,
  BRANDS_PANEL_ID,
} from "@kody-ade/kody-chat-dashboard/plugins/brands";
import { PACKAGE_ADMIN_PAGES } from "@kody-ade/kody-chat-dashboard/admin-pages";
import {
  changelogChatPlugin,
  CHANGELOG_PANEL_ID,
} from "../chat/plugins/changelog";
import {
  commandsPageChatPlugin,
  COMMANDS_PAGE_PANEL_ID,
} from "@kody-ade/kody-chat-dashboard/plugins/commands-page";
import { companyChatPlugin, COMPANY_PANEL_ID } from "../chat/plugins/company";
import { configChatPlugin, CONFIG_PANEL_ID } from "../chat/plugins/config";
import { docsChatPlugin, DOCS_PANEL_ID } from "../chat/plugins/docs";
import { filesChatPlugin, FILES_PANEL_ID } from "../chat/plugins/files";
import { inboxChatPlugin, INBOX_PANEL_ID } from "../chat/plugins/inbox";
import { liveEventsChatPlugin } from "../chat/plugins/live-events";
import {
  instructionsChatPlugin,
  INSTRUCTIONS_PANEL_ID,
} from "@kody-ade/kody-chat-dashboard/plugins/instructions";
import {
  messagesChatPlugin,
  MESSAGES_PANEL_ID,
} from "../chat/plugins/messages";
import {
  modelsChatPlugin,
  MODELS_PANEL_ID,
} from "@kody-ade/kody-chat-dashboard/plugins/models";
import {
  notificationsChatPlugin,
  NOTIFICATIONS_PANEL_ID,
} from "../chat/plugins/notifications";
import { previewChatPlugin, PREVIEW_PANEL_ID } from "../chat/plugins/preview";
import { reportsChatPlugin, REPORTS_PANEL_ID } from "../chat/plugins/reports";
import {
  secretsChatPlugin,
  SECRETS_PANEL_ID,
} from "@kody-ade/kody-chat-dashboard/plugins/secrets";
import {
  storeCatalogChatPlugin,
  STORE_CATALOG_PANEL_ID,
} from "../chat/plugins/store-catalog";
import { todosChatPlugin, TODOS_PANEL_ID } from "../chat/plugins/todos";
import {
  variablesChatPlugin,
  VARIABLES_PANEL_ID,
} from "../chat/plugins/variables";
import {
  workflowsChatPlugin,
  WORKFLOWS_PANEL_ID,
} from "../chat/plugins/workflows";
import { useEngineSetupOpeningAction } from "@dashboard/features/engine-setup/hooks/useEngineSetupOpeningAction";
import { isPersonalDashboardPath } from "@dashboard/lib/kody-scope";

// Admin plugin composition (Step 6 / M6: the HOST owns the plugin list, so
// each surface bundles only what it imports). Both KodyChat mounts (desktop
// rail + mobile sheet) register the same set under the default FULL_GRANT.
// Order matches the pre-Step-6 built-in registration order: terminal,
// commands, then vibe.
const PERSONAL_CHAT_PLUGINS = [
  { plugin: terminalChatPlugin },
  // Live transport (Convex chatEvents subscription) — inert without
  // NEXT_PUBLIC_CONVEX_URL; the live runner then keeps interval polling.
  { plugin: liveEventsChatPlugin },
  { plugin: commandsChatPlugin },
  { plugin: commandsPageChatPlugin },
  { plugin: instructionsChatPlugin },
  { plugin: modelsChatPlugin },
  { plugin: secretsChatPlugin },
];

const REPOSITORY_CHAT_PLUGINS = [
  { plugin: vibeChatPlugin },
  // Tasks page-plugin (phase 2 step 3 pilot) — contributes the "tasks"
  // panel view the flipped layout renders in place of the raw /tasks route
  // children. Inert with the chat-first toggle off.
  { plugin: tasksChatPlugin },
  // Phase 2 step 4 page-plugins — panels only, inert with the toggle off.
  { plugin: activityChatPlugin },
  { plugin: agencyRunsChatPlugin },
  { plugin: agentsChatPlugin },
  { plugin: brandsChatPlugin },
  ...PACKAGE_ADMIN_PAGES.map((page) => ({ plugin: page.plugin })),
  { plugin: changelogChatPlugin },
  { plugin: companyChatPlugin },
  { plugin: configChatPlugin },
  { plugin: docsChatPlugin },
  { plugin: filesChatPlugin },
  { plugin: inboxChatPlugin },
  { plugin: messagesChatPlugin },
  { plugin: notificationsChatPlugin },
  { plugin: previewChatPlugin },
  { plugin: reportsChatPlugin },
  { plugin: storeCatalogChatPlugin },
  { plugin: todosChatPlugin },
  { plugin: variablesChatPlugin },
  { plugin: workflowsChatPlugin },
];

const ADMIN_CHAT_PLUGINS = [
  ...PERSONAL_CHAT_PLUGINS,
  ...REPOSITORY_CHAT_PLUGINS,
];

// ─── Route → plugin panel mapping (phase 2 step 3 pilot) ───────────────
// Host-side map for now (deliberately simple): in the flipped layout, when
// the current repo-relative route has an entry here AND a registered admin
// plugin contributes a panel with that id, the shell renders the PLUGIN's
// panel view instead of the raw route children. Only /tasks pilots the
// mechanism this step — every other route keeps route-content rendering.
// With the chat-first toggle OFF this map is never consulted.
const ROUTE_PANEL_IDS: Readonly<Record<string, string>> = {
  "/tasks": TASKS_PANEL_ID,
  // Phase 2 step 4 — every migrated admin page routes to its plugin panel.
  "/activity": ACTIVITY_PANEL_ID,
  "/agency-runs": AGENCY_RUNS_PANEL_ID,
  "/findings": REPORTS_PANEL_ID,
  "/learning": REPORTS_PANEL_ID,
  "/agents": AGENTS_PANEL_ID,
  "/brands": BRANDS_PANEL_ID,
  ...Object.fromEntries(
    PACKAGE_ADMIN_PAGES.map((page) => [page.href, page.panelId]),
  ),
  "/changelog": CHANGELOG_PANEL_ID,
  "/commands": COMMANDS_PAGE_PANEL_ID,
  "/company": COMPANY_PANEL_ID,
  "/config": CONFIG_PANEL_ID,
  "/docs": DOCS_PANEL_ID,
  "/files": FILES_PANEL_ID,
  "/inbox": INBOX_PANEL_ID,
  "/instructions": INSTRUCTIONS_PANEL_ID,
  "/messages": MESSAGES_PANEL_ID,
  "/models": MODELS_PANEL_ID,
  "/notifications": NOTIFICATIONS_PANEL_ID,
  "/preview": PREVIEW_PANEL_ID,
  "/reports": REPORTS_PANEL_ID,
  "/secrets": SECRETS_PANEL_ID,
  "/store-catalog": STORE_CATALOG_PANEL_ID,
  "/todos": TODOS_PANEL_ID,
  "/variables": VARIABLES_PANEL_ID,
  "/workflows": WORKFLOWS_PANEL_ID,
};

// Stable host-context snapshot for route panels (no per-render identity
// churn). Step 3 panels take no host context yet.
const EMPTY_PANEL_HOST: Readonly<Record<string, unknown>> = Object.freeze({});

function findAdminPanel(panelId: string | undefined) {
  if (!panelId) return null;
  for (const { plugin } of ADMIN_CHAT_PLUGINS) {
    const match = plugin.panels?.find((panel) => panel.id === panelId);
    if (match) return match;
  }
  return null;
}

interface ChatRailApi {
  scope: ChatContext | null;
  setScope: (next: ChatContext | null) => void;
  /** Programmatically open the mobile chat sheet (e.g. from an error state). */
  openMobileChat: () => void;
  /**
   * Register a listener that fires when a chat tool creates a new issue
   * (`create_*`, `report_bug`). The chat will have already migrated the
   * running conversation to that issue's chat store by the time this
   * fires — the host typically just navigates (e.g. updates the URL's
   * `?issue=N` param on the Vibe page) so the user lands on the new
   * issue and sees the transferred history.
   *
   * Pass `null` to unregister (e.g. on unmount).
   */
  setOnIssueCreated: (cb: ((issueNumber: number) => void) | null) => void;
  /**
   * Attach a context chip to the chat composer (e.g. an element picked from
   * the Vibe preview). The chat shows `label` as a removable pill and appends
   * `context` to the next outgoing message. `id` makes it idempotent. Pass
   * `null` to clear. Mirrors how PreviewModal passes `composerInjection`
   * directly — Vibe routes it through here because its chat is the rail.
   */
  setComposerInjection: (
    injection: { id: string; label: string; context: string } | null,
  ) => void;
  /**
   * Attach an image to the chat composer (e.g. a Vibe-preview screenshot).
   * Mirrors `setComposerInjection` but for the attachment list. Pass `null`
   * to clear.
   */
  setAttachmentInjection: (
    injection: {
      id: string;
      name: string;
      dataUrl: string;
      mimeType: string;
    } | null,
  ) => void;
  /**
   * Ambient context for the active preview workspace selection. The chat
   * appends this invisibly on send; pages clear it on unmount.
   */
  setPreviewContext: (context: string | null) => void;
  /** Register the remote browser runner owned by the mounted Views page. */
  setPreviewActionRunner: (
    runner: ComponentProps<typeof KodyChat>["previewActionRunner"],
  ) => void;
  /** Page-level escape hatch for views that render their own top header. */
  setPageOwnsHeader: (ownsHeader: boolean) => void;
}

const ChatRailContext = createContext<ChatRailApi | null>(null);

type ViewsPreviewActionRunner = NonNullable<
  ComponentProps<typeof KodyChat>["previewActionRunner"]
> | null;
let registeredViewsPreviewActionRunner: ViewsPreviewActionRunner = null;
function getRegisteredViewsPreviewActionRunner(): ViewsPreviewActionRunner {
  return registeredViewsPreviewActionRunner;
}

/**
 * Read & control the persistent chat. Returns a no-op API when called
 * outside the rail (e.g. before auth loads or while the RepoManager
 * empty-state is shown) so callers don't need to special-case it.
 */
export function useChatScope(): ChatRailApi {
  return useContext(ChatRailContext) ?? NOOP_API;
}

const NOOP_API: ChatRailApi = {
  scope: null,
  setScope: () => {},
  openMobileChat: () => {},
  setOnIssueCreated: () => {},
  setComposerInjection: () => {},
  setAttachmentInjection: () => {},
  setPreviewContext: () => {},
  setPreviewActionRunner: () => {},
  setPageOwnsHeader: () => {},
};

// Routes that must NOT render the dashboard rail. Client chat owns its own
// full-page shell and must not inherit admin dashboard chrome.
const PUBLIC_ROUTE_PREFIXES: readonly string[] = ["/client"];
type OpeningAction = NonNullable<
  ComponentProps<typeof KodyChat>["openingActions"]
>[number];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function ChatRailShellInner({ children }: { children: ReactNode }) {
  const guidedFlowChat = useGuidedFlowChat();
  const engineSetupOpeningAction = useEngineSetupOpeningAction();
  const openingActions = useMemo(
    () => (engineSetupOpeningAction ? [engineSetupOpeningAction] : []),
    [engineSetupOpeningAction],
  );
  const handleOpeningAction = useCallback(
    (action: OpeningAction) => {
      const guidedFlowId = action.result?.guidedFlowId;
      if (typeof guidedFlowId !== "string" || !guidedFlowId.trim()) {
        return false;
      }
      guidedFlowChat.startFlowInChat(guidedFlowId);
      return true;
    },
    [guidedFlowChat],
  );
  const pathname = usePathname();
  const publicRoute = isPublicRoute(pathname);
  const hostAuth = useAuth();
  const { auth, loading } = hostAuth;
  const hasRepository = Boolean(auth?.owner && auth.repo);
  const repositoryActive =
    hasRepository && !isPersonalDashboardPath(pathname ?? "");
  const personalPageAuth = useMemo(
    () =>
      isPersonalDashboardPath(pathname ?? "")
        ? { ...hostAuth, auth: null }
        : hostAuth,
    [hostAuth, pathname],
  );
  const hostTheme = useTheme();
  const { githubUser } = useGitHubIdentity();
  const { data: kodySession } = kodyAuthClient.useSession();
  const navSections = useSidebarNavSections();
  const [scope, setScope] = useState<ChatContext | null>(null);
  // Mobile "chat open" — persisted per-device (same as the desktop expand
  // state) so opening chat survives a reload / navigation, not just the
  // in-memory session.
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  useEffect(() => {
    setMobileOpen(localStorage.getItem("kody:mobile-chat-open") === "1");
  }, []);
  const setMobileOpenPersist = useCallback((next: boolean) => {
    setMobileOpen(next);
    try {
      localStorage.setItem("kody:mobile-chat-open", next ? "1" : "0");
    } catch {
      // localStorage unavailable (private mode) — non-fatal.
    }
  }, []);

  // Rail width + drag-to-resize moved into the shared ChatShell.
  // "Expanded chat" is the /chat route — a real page, not a cross-page
  // overlay. The expand button navigates to /chat; restore returns to the
  // page you expanded from (so browsing away from /chat just shows that
  // page — chat never hovers over it). Remembered in a ref for the session.
  const router = useRouter();
  const currentRepoPath = repoPathForNavMatching(pathname ?? "/");
  const isChatRoute =
    currentRepoPath === "/chat" || currentRepoPath.startsWith("/chat/");
  const conversationIdFromRoute = isChatRoute
    ? decodeURIComponent(currentRepoPath.slice("/chat/".length)) || null
    : null;
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (publicRoute) return;
    if (
      loading ||
      !auth?.owner ||
      !auth.repo ||
      !pathname ||
      isChatRoute ||
      isPersonalDashboardPath(pathname)
    )
      return;
    const target = legacyRepoRedirectPath(auth, pathname);
    if (!target) return;
    router.replace(`${target}${window.location.search}${window.location.hash}`);
  }, [auth, isChatRoute, loading, pathname, publicRoute, router]);

  // The auth context derives the active repo from the URL, so the only
  // sync state left to handle is "missing" — a /repo/<owner>/<repo> URL we
  // have no credentials for ("switch" can no longer occur).
  const repoRouteAuthSync = publicRoute
    ? ({ status: "none" } as const)
    : resolveRepoRouteAuthSync(pathname ?? "/", auth);

  const preExpandRouteRef = useRef("/tasks");

  // ─── Chat-first layout flip (phase 2 step 2, per-user, default ON) ───
  // Desktop only: the routed page can render through the plugin panel host
  // while the visible rail/page geometry stays identical to the classic
  // layout. The route stays the source of truth (deep links + back button
  // work unchanged). Mobile keeps the existing behavior (page + chat sheet).
  const chatFirst = useChatFirstLayout();
  const flipActive = chatFirst && !publicRoute && !!auth;
  useEffect(() => {
    if (!flipActive || isChatRoute) return;
    trace({ kind: "panel:open", detail: currentRepoPath });
  }, [flipActive, currentRepoPath, isChatRoute]);
  const scopedHref = useCallback(
    (href: string) =>
      repositoryActive && auth ? repoScopedHref(auth, href) : href,
    [auth, repositoryActive],
  );
  const toggleExpandedChat = useCallback(() => {
    if (isChatRoute) {
      router.push(preExpandRouteRef.current || scopedHref("/tasks"));
    } else {
      preExpandRouteRef.current = pathname || scopedHref("/tasks");
      router.push(
        scopedHref(
          activeConversationId
            ? `/chat/${encodeURIComponent(activeConversationId)}`
            : "/chat",
        ),
      );
    }
  }, [activeConversationId, isChatRoute, pathname, router, scopedHref]);

  const syncConversationRoute = useCallback(
    (conversationId: string | null) => {
      setActiveConversationId(conversationId);
      if (!isChatRoute) return;
      const target = scopedHref(
        conversationId
          ? `/chat/${encodeURIComponent(conversationId)}`
          : "/chat",
      );
      if (pathname !== target) router.replace(target, { scroll: false });
    },
    [isChatRoute, pathname, router, scopedHref],
  );

  // Escape always exits the full /chat view, even if the chat header is
  // hidden by a layout glitch (e.g. session sidebar overflowing on a narrow
  // window). Without this the user is stuck and has to reach for the
  // browser back button.
  useEffect(() => {
    if (!isChatRoute) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(preExpandRouteRef.current || scopedHref("/tasks"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isChatRoute, router, scopedHref]);

  // Hydration guard: SSR has no localStorage so `auth` is always null on
  // the server. Without this flag the first client render would diverge
  // from the server HTML and React would bail out with hydration error
  // #418. We force the first client paint to match the server (no rail),
  // then flip on a layout effect so the rail appears immediately.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const openMobileChat = useCallback(() => {
    setMobileOpenPersist(true);
  }, [setMobileOpenPersist]);

  useEffect(() => {
    const openChatForInteractiveContent = () => openMobileChat();
    window.addEventListener(WIDGET_OPEN_EVENT, openChatForInteractiveContent);
    return () => {
      window.removeEventListener(
        WIDGET_OPEN_EVENT,
        openChatForInteractiveContent,
      );
    };
  }, [openMobileChat]);

  useEffect(() => {
    if (!guidedFlowChat.pending) return;
    if (guidedFlowChat.pending.destination === "chat") {
      if (!isChatRoute) router.push(scopedHref("/chat"));
      return;
    }
    openMobileChat();
  }, [isChatRoute, guidedFlowChat.pending, openMobileChat, router, scopedHref]);

  // Ref, not state, so registering/unregistering doesn't re-render the
  // entire app tree under the rail. The KodyChat instance reads the
  // current value through a stable proxy callback wired below.
  const onIssueCreatedRef = useRef<((issueNumber: number) => void) | null>(
    null,
  );
  const setOnIssueCreated = useCallback(
    (cb: ((issueNumber: number) => void) | null) => {
      onIssueCreatedRef.current = cb;
    },
    [],
  );
  // Stable wrapper passed to KodyChat — dispatches to whatever callback
  // the host has currently registered. Stable identity keeps useCallback
  // / useEffect deps inside KodyChat from churning.
  const dispatchIssueCreated = useCallback((issueNumber: number) => {
    onIssueCreatedRef.current?.(issueNumber);
  }, []);
  const reportIssueRef = useRef<(() => void) | null>(null);
  const setIssueReporter = useCallback((report: (() => void) | null) => {
    reportIssueRef.current = report;
  }, []);
  const openIssueReport = useCallback(() => {
    reportIssueRef.current?.();
  }, []);

  // Composer context chip (picked Vibe-preview element) — held as state so
  // both KodyChat instances below re-render with the new chip.
  const [composerInjection, setComposerInjection] = useState<{
    id: string;
    label: string;
    context: string;
  } | null>(null);
  const [attachmentInjection, setAttachmentInjection] = useState<{
    id: string;
    name: string;
    dataUrl: string;
    mimeType: string;
  } | null>(null);
  const [previewContext, setPreviewContext] = useState<string | null>(null);
  const [previewActionRunner, setPreviewActionRunnerState] =
    useState<ViewsPreviewActionRunner>(null);
  const setPreviewActionRunner = useCallback(
    (runner: ComponentProps<typeof KodyChat>["previewActionRunner"]) => {
      // React treats a bare function passed to a state setter as an updater.
      // Wrap the runner so Views stores the function itself.
      const normalizedRunner = runner ?? null;
      registeredViewsPreviewActionRunner = normalizedRunner;
      setPreviewActionRunnerState(() => normalizedRunner);
    },
    [],
  );
  const [pageHeaderOwnedByChild, setPageOwnsHeader] = useState(false);

  const api = useMemo<ChatRailApi>(
    () => ({
      scope,
      setScope,
      openMobileChat,
      setOnIssueCreated,
      setComposerInjection,
      setAttachmentInjection,
      setPreviewContext,
      setPreviewActionRunner,
      setPageOwnsHeader,
    }),
    [scope, openMobileChat, setOnIssueCreated, setPreviewActionRunner],
  );

  // Chat is app-level, so the shell remains available before repository
  // setup. Repository credentials enrich Chat with repository-backed tools;
  // they do not own its visibility or its bootstrap GuidedFlows.
  const showRail =
    hydrated && !loading && !publicRoute && Boolean(kodySession?.user);

  if (!showRail) {
    return (
      <ChatRailContext.Provider value={api}>
        <NotificationsProvider>
          <SettingsDrawerProvider>
            <CommandPalette />
            {children}
          </SettingsDrawerProvider>
        </NotificationsProvider>
      </ChatRailContext.Provider>
    );
  }

  // The desktop KodyChat stays mounted (hidden, not unmounted) so
  // history/streaming survive navigation. It renders two ways:
  //   • /chat  → full-width main pane (the primary assistant view)
  //   • else   → fixed-width side rail beside the page (tasks, vibe,
  //              settings…); on mobile non-chat it hides and a SECOND
  //              KodyChat instance mounts in the sheet opened from the
  //              header's chat button (see the fixed panel below).
  // Kody Live remains the default agent (only it can edit code); the model
  // dropdown still lets the user pick any configured LLM for chat-only turns.
  const isVibeRoute =
    currentRepoPath === "/vibe" || currentRepoPath.startsWith("/vibe/");
  const isOrgRoute =
    pathname === "/org" || (pathname?.startsWith("/org/") ?? false);
  const repoRouteBlocksPage = repoRouteAuthSync.status === "missing";
  // Routes whose page renders its OWN in-pane header (KodyDashboard on the
  // tasks list, new-task / report-bug modals, and issue detail at /<number>;
  // plus Vibe). The shared AppHeader must NOT render on these or two headers
  // stack. KodyDashboard mounts on all of: /tasks, /new, /bug,
  // /report-kody-bug, and /<issueNumber>(/…) — see app/. Note /bug and /new
  // are also reached mid-session via KodyDashboard's history.pushState when a
  // modal opens, so they must be listed even though no route file navigates
  // here directly.
  const pageOwnsHeader =
    !!auth &&
    !repoRouteBlocksPage &&
    (routeOwnsAppHeader(currentRepoPath) || pageHeaderOwnedByChild);
  const lockedAgentId = isOrgRoute ? "kody" : undefined;
  const bootstrapWelcome = !repositoryActive ? (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Your private Chat</p>
      <p className="mx-auto max-w-sm text-sm">
        Chat works without a repository. Attach one when you need repository
        context, tools, and Agency.
      </p>
    </div>
  ) : undefined;
  // Flipped layout only: if a registered plugin owns a panel for this
  // route, its view replaces the raw route children (step 3 pilot —
  // currently just /tasks). Auth-sync blocking states below still win.
  const routePanel = flipActive
    ? findAdminPanel(ROUTE_PANEL_IDS[currentRepoPath])
    : null;
  const RoutePanelRender = routePanel?.render;
  const pageContent =
    repoRouteAuthSync.status === "missing" ? (
      <RepoManager />
    ) : RoutePanelRender ? (
      <RoutePanelRender host={EMPTY_PANEL_HOST} />
    ) : (
      children
    );

  const chatPane = (
    <KodyAuthBridgeProvider value={personalPageAuth}>
      <KodyChat
        conversationId={conversationIdFromRoute}
        onConversationChange={syncConversationRoute}
        guidedFlowRequest={
          (isDesktop || isChatRoute) &&
          !(guidedFlowChat.pending?.destination === "chat" && !isChatRoute)
            ? guidedFlowChat.pending
            : null
        }
        onGuidedFlowRequestHandled={guidedFlowChat.acknowledge}
        context={repositoryActive ? scope : null}
        actorLogin={repositoryActive ? githubUser?.login : kodySession?.user.id}
        emptyStateWelcome={bootstrapWelcome}
        openingActions={repositoryActive ? openingActions : undefined}
        onOpeningAction={handleOpeningAction}
        lockedAgentId={lockedAgentId}
        allowAgencyAgentSelection={repositoryActive}
        vibeMode={isVibeRoute}
        onIssueCreated={dispatchIssueCreated}
        onIssueReportReady={setIssueReporter}
        composerInjection={composerInjection}
        attachmentInjection={attachmentInjection}
        previewContext={previewContext}
        previewActionRunner={previewActionRunner}
        getPreviewActionRunner={getRegisteredViewsPreviewActionRunner}
        plugins={repositoryActive ? ADMIN_CHAT_PLUGINS : PERSONAL_CHAT_PLUGINS}
        // Expand = navigate to the /chat page; restore = back to the previous
        // page. On /chat the button reads as "restore" (railFullscreen).
        onToggleFullscreen={toggleExpandedChat}
        railFullscreen={isChatRoute}
      />
    </KodyAuthBridgeProvider>
  );

  return (
    <ChatRailContext.Provider value={api}>
      <KodyAuthBridgeProvider value={hostAuth}>
        <KodyThemeBridgeProvider value={hostTheme}>
          <NotificationsProvider>
            <SettingsDrawerProvider>
              <CommandPalette />
              {/* The shared shell owns the layout (nav | chat | page) — this
              wrapper only supplies the dashboard-specific chat pane, header,
              and page content. Shell chrome (repo switcher in the sidepanel,
              rail resize) is inherited from @kody-ade/kody-chat-dashboard. */}
              {/* Explicit sections: the Engineer list is the superset (Vibe and
              Preview included), so the old Vibe/Engineer toggle is gone. */}
              <ChatShell
                title="Kody"
                sections={navSections}
                pinnedItem={null}
                sidebarBrandExtra={<SidebarNotifications />}
                sidebarAccount={
                  kodySession?.user
                    ? {
                        label: kodySession.user.email || kodySession.user.name,
                        ...(kodySession.user.image
                          ? { imageUrl: kodySession.user.image }
                          : {}),
                        onSignOut: () => {
                          clearBrowserRepositorySession();
                          void kodyAuthClient.signOut().then(() => {
                            window.location.href = "/";
                          });
                        },
                      }
                    : undefined
                }
                chat={chatPane}
                onReportIssue={openIssueReport}
                isChatHome={isChatRoute}
                showMobileHeader={false}
                contentTestId={flipActive ? "chat-first-panel" : undefined}
              >
                {!pageOwnsHeader && <AppHeader />}
                <div className="flex-1 min-h-0 flex flex-col">
                  <KodyAuthBridgeProvider value={personalPageAuth}>
                    {pageContent}
                  </KodyAuthBridgeProvider>
                </div>
              </ChatShell>

              {/* Mobile chat — opens as a panel BELOW the top header (no backdrop)
          so the header stays visible and its hamburger (nav + filters) is
          still reachable while chatting. The rail is desktop-only; on mobile
          chat is opened from the header's chat button. Not shown on /chat
          (chat is the full view) or /messages (its own chat surface). */}
              {mobileOpen &&
                !isDesktop &&
                !isChatRoute &&
                !currentRepoPath.startsWith("/messages") && (
                  <div className="fixed inset-x-0 bottom-0 top-16 z-30 flex flex-col border-t border-border bg-background md:hidden">
                    <KodyAuthBridgeProvider value={personalPageAuth}>
                      <KodyChat
                        guidedFlowRequest={
                          !isDesktop &&
                          guidedFlowChat.pending?.destination !== "chat"
                            ? guidedFlowChat.pending
                            : null
                        }
                        onGuidedFlowRequestHandled={guidedFlowChat.acknowledge}
                        context={repositoryActive ? scope : null}
                        actorLogin={
                          repositoryActive
                            ? githubUser?.login
                            : kodySession?.user.id
                        }
                        emptyStateWelcome={bootstrapWelcome}
                        openingActions={
                          repositoryActive ? openingActions : undefined
                        }
                        onOpeningAction={handleOpeningAction}
                        onClose={() => setMobileOpenPersist(false)}
                        lockedAgentId={lockedAgentId}
                        allowAgencyAgentSelection={repositoryActive}
                        vibeMode={isVibeRoute}
                        onIssueCreated={dispatchIssueCreated}
                        composerInjection={composerInjection}
                        attachmentInjection={attachmentInjection}
                        previewContext={previewContext}
                        previewActionRunner={previewActionRunner}
                        getPreviewActionRunner={
                          getRegisteredViewsPreviewActionRunner
                        }
                        plugins={
                          repositoryActive
                            ? ADMIN_CHAT_PLUGINS
                            : PERSONAL_CHAT_PLUGINS
                        }
                      />
                    </KodyAuthBridgeProvider>
                  </div>
                )}
            </SettingsDrawerProvider>
          </NotificationsProvider>
        </KodyThemeBridgeProvider>
      </KodyAuthBridgeProvider>
    </ChatRailContext.Provider>
  );
}

export function ChatRailShell({ children }: { children: ReactNode }) {
  return (
    <GuidedFlowChatProvider>
      <ChatRailShellInner>{children}</ChatRailShellInner>
    </GuidedFlowChatProvider>
  );
}
