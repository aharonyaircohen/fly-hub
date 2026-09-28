/**
 * @fileType data
 * @domain kody
 * @pattern settings-nav
 * @ai-summary Single source of truth for the settings sidebar
 *   (SettingsDrawer + MobileMenu). Defines sections + items so both
 *   sidebars render the same grouping. Add new pages here once; both
 *   sidebars pick them up automatically.
 */
import {
  Activity,
  AppWindow,
  Bell,
  Blocks,
  Bot,
  Brain,
  Building2,
  CheckCircle2,
  Cloud,
  Code,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  History,
  Home,
  KeyRound,
  Layers,
  LayoutGrid,
  MessageSquare,
  MonitorPlay,
  Network,
  Package,
  Palette,
  Plug,
  Route,
  Scale,
  ScrollText,
  Share2,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  ShieldAlert,
  Target,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PACKAGE_ADMIN_PAGE_META } from "@kody-ade/base/admin-pages-meta";
import { repoPathForNavMatching } from "@kody-ade/base/routes";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Long-form blurb for the desktop drawer. */
  description?: string;
  /** Tailwind classes for the mobile menu's icon tint chip. */
  tint?: string;
  /**
   * Items own their path and every detail route below it by default.
   * Set this only when child paths are separate pages owned elsewhere.
   */
  exact?: boolean;
  /** Extra route shapes owned by this item, e.g. task issue-number pages. */
  activePathPatterns?: readonly RegExp[];
  /** Personal destinations stay outside the active repository URL. */
  scope?: "personal" | "repository";
}

/**
 * Primary surfaces — the top of the sidebar and the first palette group.
 * Shared so the Sidebar, CommandPalette (and eventually MobileMenu) render
 * one list instead of drifting copies.
 */
/** Chat — the primary assistant view. NOT rendered in the nav lists (the
 *  header ViewToggle switches Chat/Tasks); kept here only so navLabelForPath
 *  can resolve "/chat" → "Chat" and as the canonical home href. */
export const HOME_NAV_ITEM: SettingsNavItem = {
  href: "/chat",
  label: "Chat",
  icon: MessageSquare,
  exact: true,
  description: "Chat with Kody — coding help, notes, and ideas.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Tasks view — sibling of Chat. Also NOT rendered in the nav lists (same
 *  ViewToggle reason); kept only so navLabelForPath resolves "/tasks". */
export const TASKS_NAV_ITEM: SettingsNavItem = {
  href: "/tasks",
  label: "Tasks",
  icon: Home,
  exact: true,
  activePathPatterns: [/^\/\d+(?:\/|$)/],
  description: "Pipelines, tasks, and run health at a glance.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Dashboard — the fixed home link at `/`. */
export const DASHBOARD_NAV_ITEM: SettingsNavItem = {
  href: "/",
  label: "Dashboard",
  icon: Home,
  exact: true,
  description: "Dashboard home.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Vibe — chat-driven preview. Now a first-class nav entry (it used to be a
 *  header on/off toggle). */
export const VIBE_NAV_ITEM: SettingsNavItem = {
  href: "/vibe",
  label: "Vibe",
  icon: Sparkles,
  description: "Chat-driven preview — approve and ship.",
  tint: "text-fuchsia-300 bg-fuchsia-500/10",
};

export const PREVIEW_NAV_ITEM: SettingsNavItem = {
  href: "/preview",
  label: "Views",
  icon: MonitorPlay,
  description:
    "View any environment — Production, Staging, Dev — with saved paths, device sizes, and element-pick into chat.",
  tint: "text-sky-300 bg-sky-500/10",
};

export const TODOS_NAV_ITEM: SettingsNavItem = {
  href: "/todos",
  label: "Todos",
  icon: CheckCircle2,
  description: "Finite outcomes with evidence, blockers, and related Runs.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/**
 * Primary view switch (Dashboard / Tasks / Vibe), rendered at the very top of
 * the sidebar rail and mobile menu. Replaces the old header ViewToggle +
 * VibeToggle — navigation now lives entirely in the nav. Shared so the desktop
 * Sidebar and MobileMenu can't drift.
 */
export const PRIMARY_VIEW_TITLE = "Views" as const;

export const PRIMARY_VIEW_ITEMS: readonly SettingsNavItem[] = [
  DASHBOARD_NAV_ITEM,
  { ...TASKS_NAV_ITEM, icon: LayoutGrid },
  VIBE_NAV_ITEM,
];

/** Heading shown above the primary surfaces in the expanded sidebar rail. */
export const PRIMARY_NAV_TITLE = "Workspace" as const;

export const PRIMARY_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    href: "/apps",
    label: "Apps",
    icon: AppWindow,
    description: "Deploy and manage repository applications.",
    tint: "text-cyan-300 bg-cyan-500/10",
  },
  {
    href: "/org",
    label: "Org",
    icon: Building2,
    description: "Org workspace — manage attached repositories.",
    tint: "text-emerald-300 bg-emerald-500/10",
  },

  {
    href: "/inbox",
    label: "Inbox",
    icon: Bell,
    description:
      "Everything Kody is waiting on you for — approvals, requests, and mentions.",
    tint: "text-amber-300 bg-amber-500/10",
  },
  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    description: "Team chat history.",
    tint: "text-cyan-300 bg-cyan-500/10",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: FileText,
    description: "Outputs from capability runs.",
    tint: "text-sky-300 bg-sky-500/10",
  },
  PREVIEW_NAV_ITEM,
] as const;

export interface SettingsNavSection {
  /** Optional ownership divider rendered before this section. */
  contextLabel?: "Account" | "Repository";
  /** Section heading shown above its items. */
  title: string;
  items: readonly SettingsNavItem[];
  /** Icon shown on a collapsible desktop-rail group. */
  icon?: LucideIcon;
  /** Subtle icon color for a collapsible desktop-rail group. */
  tint?: string;
  /** Collapsed in the desktop rail until the user opens this group. */
  collapsible?: boolean;
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: "Content",
    items: [
      {
        href: "/connections",
        label: "Connections",
        icon: Share2,
        description: "Manage the external accounts Kody may use.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/content/entries",
        label: "Entries",
        icon: Database,
        description: "Browse and edit content entries.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/content/models",
        label: "Models",
        icon: Layers,
        description: "Define content collections and fields.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/snippets",
        label: "Snippets",
        icon: Code,
        description: "Scripts and HTML injected into brand pages.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/triggers",
        label: "Triggers",
        icon: Zap,
        description: "Rules that react to system events and save user data.",
        tint: "text-yellow-300 bg-yellow-500/10",
      },
      {
        href: "/content/settings",
        label: "Settings",
        icon: Settings2,
        exact: true,
        description: "Adapter, schema, permissions, and MCP settings.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
    ],
  },
  {
    title: "Knowledge",
    items: [
      {
        href: "/docs",
        label: "Docs",
        icon: FileText,
        description: "README and docs folder from the repo.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/context",
        label: "Context",
        icon: FileText,
        description:
          "Curated markdown context you feed Kody — attach to agent; Kody's entries frame every chat turn.",
        tint: "text-teal-300 bg-teal-500/10",
      },
      {
        href: "/policies",
        label: "Policies",
        icon: Scale,
        description: "Decision rules that guide Kody's behavior.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/constraints",
        label: "Constraints",
        icon: ShieldAlert,
        description: "Hard limits and guardrails for Kody.",
        tint: "text-rose-300 bg-rose-500/10",
      },
      {
        href: "/memory",
        label: "Memory",
        icon: Brain,
        description:
          "Persistent facts and feedback Kody remembers across chat turns.",
        tint: "text-fuchsia-300 bg-fuchsia-500/10",
      },
      {
        href: "/file-spaces",
        label: "Manage Spaces",
        icon: Settings2,
        exact: true,
        description: "Add and organize repository-backed knowledge spaces.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "Fly",
    items: [
      {
        href: "/fly/config",
        label: "Config",
        icon: SlidersHorizontal,
        exact: true,
        description: "Fly token, runners, and Brain settings.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/brain",
        label: "Brain",
        icon: Brain,
        exact: true,
        description: "Manage Brain runtime and chat models.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/fly/previews",
        label: "Previews",
        icon: MonitorPlay,
        exact: true,
        description: "Preview URLs, machines, and PR preview settings.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/fly/brain-images",
        label: "Brain Images",
        icon: Brain,
        exact: true,
        description: "Saved Brain runtime images and active restore selection.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/fly/machines",
        label: "Live machines",
        icon: Cpu,
        description: "Current Fly machines and actions.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/fly/volumes",
        label: "Volumes",
        icon: HardDrive,
        exact: true,
        description: "Persistent disks used by Fly apps.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/fly/history",
        label: "History",
        icon: History,
        exact: true,
        description: "Fly machine activity snapshots and estimated cost.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "Monitoring",
    items: [
      {
        href: "/activity",
        label: "Activity",
        icon: Activity,
        description: "Engine run health — queue depth, throughput, failures.",
        tint: "text-rose-300 bg-rose-500/10",
      },
    ],
  },
  {
    title: "AI Agency",
    items: [
      {
        href: "/agency",
        label: "Intents",
        icon: Target,
        description: "Manage the Agency's plain-text intents.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      TODOS_NAV_ITEM,
      {
        href: "/agency-runs",
        label: "Runs",
        icon: Route,
        description: "Execution history for capabilities and workflows.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/agents",
        label: "Agents",
        icon: Users,
        description: "Agent identities that execute your capabilities.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/agent-loops",
        label: "Loops",
        icon: History,
        description: "Simple triggers for a workflow or capability.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/workflows",
        label: "Workflows",
        icon: Workflow,
        description: "Visual capability flows.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/pipelines",
        label: "Pipelines",
        icon: Route,
        description: "Ordered reusable Workflow sequences.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/capabilities",
        label: "Capabilities",
        icon: Layers,
        description: "Simple executable folders.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "Store",
    items: [
      {
        href: "/store-catalog",
        label: "Store Catalog",
        icon: Package,
        description:
          "Browse shared store items and activate them in this repo.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/company",
        label: "Import / Export",
        icon: Building2,
        description:
          "Move your AI Agency setup between repos as a portable bundle.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Quality",
    items: [
      {
        href: "/quality/scenarios",
        label: "Scenarios",
        icon: ShieldAlert,
        description: "Define the complete test you want to run.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/quality/journeys",
        label: "Journeys",
        icon: Route,
        description: "Add user goals to a Scenario.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/quality/actions",
        label: "Actions",
        icon: Zap,
        description: "Add reusable steps to a Journey.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/quality/runs",
        label: "Quality Runs",
        icon: Activity,
        description: "Run tests and inspect immutable evidence.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
    ],
  },
  {
    title: "Agent Settings",
    items: [
      {
        href: "/guided-flows",
        label: "Guided Flows",
        icon: Route,
        description: "Define chat-guided experiences and their renderers.",
        tint: "text-teal-300 bg-teal-500/10",
      },
      {
        href: "/models",
        label: "Personal Chat Models",
        icon: Cpu,
        description: "Your chat models, available across repositories.",
        tint: "text-emerald-300 bg-emerald-500/10",
        scope: "personal",
      },
      {
        href: "/repository-models",
        label: "Repo Chat Models",
        icon: Cpu,
        description: "Chat models shared with everyone using this repository.",
        tint: "text-fuchsia-300 bg-fuchsia-500/10",
        scope: "repository",
      },
      {
        href: "/commands",
        label: "Commands",
        icon: Bot,
        description: "Slash commands in the chat composer.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/brands",
        label: "Brands",
        icon: Palette,
        description: "Client chat branding for /client surfaces.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      ...PACKAGE_ADMIN_PAGE_META.map((page) => ({
        href: page.href,
        label: page.label,
        icon: page.icon,
        description: page.description,
        tint: page.tint,
      })),
      {
        href: "/views/renderers",
        label: "View Renderers",
        icon: LayoutGrid,
        description: "Renderer JSON for structured chat UI.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/views/widgets",
        label: "Widgets",
        icon: Blocks,
        description: "Per-tenant widget bundles for chat surfaces.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/instructions",
        label: "Instructions",
        icon: ScrollText,
        description:
          "Tone, length, and behavior preferences appended to every chat turn.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
    ],
  },
  {
    title: "Engine",
    items: [
      {
        href: "/config",
        label: "Engine config",
        icon: SlidersHorizontal,
        description:
          "Repo-wide engine settings: reasoning effort, operators, quality commands, the @kody access gate, default branch, and aliases.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        href: "/mcp",
        label: "Agent connections",
        icon: Plug,
        description: "Connect any standards-compliant MCP coding agent.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/secrets",
        label: "Secrets",
        icon: KeyRound,
        description: "Encrypted per-repo secrets vault.",
        tint: "text-rose-300 bg-rose-500/10",
      },
      {
        href: "/variables",
        label: "Variables",
        icon: Settings2,
        description: "Non-secret config shared across runs.",
        tint: "text-indigo-300 bg-indigo-500/10",
      },
      {
        href: "/backend",
        label: "Backend",
        icon: Database,
        description:
          "Export state data as a JSON dump and import it into the Convex backend.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Alerts",
    items: [
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        description: "Browser + email alerts and routing rules.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "General",
    items: [
      {
        href: "/files",
        label: "Files",
        icon: FolderOpen,
        description: "Browse and edit files in your repository.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/changelog",
        label: "Changelog",
        icon: History,
        description: "What shipped, version by version.",
        tint: "text-fuchsia-300 bg-fuchsia-500/10",
      },
    ],
  },
] as const;

/** Every nav item, flattened — home + primary + all section items. */
export const ALL_NAV_ITEMS: readonly SettingsNavItem[] = [
  HOME_NAV_ITEM,
  DASHBOARD_NAV_ITEM,
  TASKS_NAV_ITEM,
  VIBE_NAV_ITEM,
  PREVIEW_NAV_ITEM,
  ...PRIMARY_NAV_ITEMS,
  ...SETTINGS_NAV_SECTIONS.flatMap((section) => section.items),
];

const NAV_ITEM_BY_HREF = new Map(
  ALL_NAV_ITEMS.map((item) => [item.href, item] as const),
);

function navItemForHref(href: string): SettingsNavItem {
  const item = NAV_ITEM_BY_HREF.get(href);
  if (!item) throw new Error(`Missing sidebar item for ${href}`);
  return item;
}

function settingsSection(title: string): SettingsNavSection {
  const section = SETTINGS_NAV_SECTIONS.find((item) => item.title === title);
  if (!section) throw new Error(`Missing sidebar section ${title}`);
  return section;
}

export const SIDEBAR_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: "Work",
    icon: LayoutGrid,
    tint: "text-emerald-300",
    collapsible: true,
    items: [
      TASKS_NAV_ITEM,
      VIBE_NAV_ITEM,
      PREVIEW_NAV_ITEM,
      navItemForHref("/inbox"),
    ],
  },
  {
    title: "Agency",
    icon: Users,
    tint: "text-violet-300",
    collapsible: true,
    items: [
      navItemForHref("/agency"),
      TODOS_NAV_ITEM,
      navItemForHref("/agency-runs"),
      navItemForHref("/agents"),
      navItemForHref("/agent-loops"),
      navItemForHref("/workflows"),
      navItemForHref("/pipelines"),
      navItemForHref("/capabilities"),
    ],
  },
  {
    title: "Store",
    icon: Package,
    tint: "text-emerald-300",
    collapsible: true,
    items: [navItemForHref("/store-catalog"), navItemForHref("/company")],
  },
  {
    title: "Quality",
    icon: CheckCircle2,
    tint: "text-cyan-300",
    collapsible: true,
    items: [
      navItemForHref("/quality/scenarios"),
      navItemForHref("/quality/journeys"),
      navItemForHref("/quality/actions"),
      navItemForHref("/quality/runs"),
    ],
  },
  {
    title: "Workspace",
    icon: Building2,
    tint: "text-sky-300",
    collapsible: true,
    items: [
      navItemForHref("/org"),
      navItemForHref("/apps"),
      navItemForHref("/messages"),
      navItemForHref("/reports"),
      navItemForHref("/files"),
      navItemForHref("/changelog"),
    ],
  },
  {
    ...settingsSection("Knowledge"),
    icon: Network,
    tint: "text-cyan-300",
    collapsible: true,
  },
  {
    ...settingsSection("Content"),
    icon: Database,
    tint: "text-amber-300",
    collapsible: true,
  },
  {
    title: "Chat",
    icon: Bot,
    tint: "text-fuchsia-300",
    collapsible: true,
    items: [
      navItemForHref("/models"),
      navItemForHref("/repository-models"),
      navItemForHref("/commands"),
      navItemForHref("/guided-flows"),
      navItemForHref("/views/renderers"),
      navItemForHref("/views/widgets"),
      navItemForHref("/instructions"),
    ],
  },
  {
    title: "Client",
    icon: Palette,
    tint: "text-cyan-300",
    collapsible: true,
    items: [
      navItemForHref("/brands"),
      ...PACKAGE_ADMIN_PAGE_META.map((page) => navItemForHref(page.href)),
    ],
  },
  {
    ...settingsSection("Fly"),
    icon: Cloud,
    tint: "text-sky-300",
    collapsible: true,
  },
  {
    title: "System",
    icon: SlidersHorizontal,
    tint: "text-slate-300",
    collapsible: true,
    items: [
      navItemForHref("/activity"),
      navItemForHref("/config"),
      navItemForHref("/secrets"),
      navItemForHref("/variables"),
      navItemForHref("/backend"),
      navItemForHref("/notifications"),
    ],
  },
];

/**
 * The desktop rail keeps one expanded submenu. A routed child reopens its
 * owning group so deep links, refresh, and browser history retain context.
 */
export function activeCollapsibleNavSectionTitle(
  sections: readonly SettingsNavSection[],
  pathname: string,
  search: string,
): string | null {
  return (
    sections.find(
      (section) =>
        section.collapsible &&
        section.items.some((item) => isNavItemActive(pathname, search, item)),
    )?.title ?? null
  );
}

/** Strip a query string off an href so "/reports?x=1" maps to "/reports". */
function navPath(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
}

export function isNavItemActive(
  pathname: string,
  search: string,
  item: SettingsNavItem,
): boolean {
  const navPathname = repoPathForNavMatching(pathname);
  const [hrefPath, hrefQuery = ""] = item.href.split("?");
  if (hrefQuery) {
    return navPathname === hrefPath && search === hrefQuery;
  }

  if (item.exact) {
    return (
      navPathname === hrefPath ||
      item.activePathPatterns?.some((pattern) => pattern.test(navPathname)) ===
        true
    );
  }

  return (
    navPathname === hrefPath ||
    navPathname.startsWith(`${hrefPath}/`) ||
    item.activePathPatterns?.some((pattern) => pattern.test(navPathname)) ===
      true
  );
}

/**
 * Resolve the human label for the page at `pathname` (e.g. "/variables" →
 * "Variables", "/secrets/docs" → "Secrets"). Matches the deepest nav path that
 * the pathname falls under; home ("/") matches only exactly. Returns null when
 * no sidebar page owns the route (e.g. /vibe, /scenario). Single source of
 * truth so callers don't hard-code page names.
 */
export function navLabelForPath(pathname: string): string | null {
  let best: { label: string; len: number } | null = null;
  for (const item of ALL_NAV_ITEMS) {
    const path = navPath(item.href);
    if (isNavItemActive(pathname, "", item)) {
      if (!best || path.length > best.len) {
        best = { label: item.label, len: path.length };
      }
    }
  }
  return best?.label ?? null;
}

/** Icon used by the drawer trigger button (kept here so we don't need to
 *  re-export from lucide elsewhere). */
export { Sparkles as SettingsDrawerSparkles };
