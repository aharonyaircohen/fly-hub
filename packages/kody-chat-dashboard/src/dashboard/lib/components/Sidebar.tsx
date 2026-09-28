/**
 * @fileType component
 * @domain kody
 * @pattern app-sidebar
 * @ai-summary Persistent left navigation rail for the Kody dashboard.
 *   Desktop only (hidden below md). Collapsible (64px ↔ 220px) with
 *   localStorage persistence. Top-level entries come from the shared
 *   workspace and settings nav lists, so desktop, mobile, and command palette
 *   destinations stay discoverable. The desktop rail can regroup a few
 *   repo-workspace pages without moving the underlying routes.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bug,
  Github,
  LogOut,
  Moon,
  Search,
  Star,
  Sun,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@kody-ade/base/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";
import { useTheme } from "../../providers/Theme";
import { cn } from "@kody-ade/base/utils/ui";
import {
  shouldEnableSidebarInboxBadgeData,
  shouldEnableSidebarMessagesBadgeData,
  shouldEnableSidebarReportsBadgeData,
} from "../github-background-polling";
import { useAuth } from "../auth-context";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useNavigationFavorites } from "../hooks/useNavigationFavorites";
import { resolveFavoriteItems } from "../navigation-favorites";
import { repoScopedHref } from "@kody-ade/base/routes";
import { SimpleTooltip } from "./SimpleTooltip";
import { InboxBadge } from "./InboxBadge";
import { MessagesBadge } from "./MessagesBadge";
import { ReportsBadge } from "./ReportsBadge";
import {
  activeCollapsibleNavSectionTitle,
  isNavItemActive,
  type SettingsNavItem,
  type SettingsNavSection,
} from "../feature-catalog";

/** Pull just the `text-…` color token out of an item's `tint` (which is a
 *  combined "text-X bg-Y" chip class) so the rail can color the bare icon. */
function iconTintClass(item: { tint?: string }): string | undefined {
  return item.tint?.split(" ").find((c) => c.startsWith("text-"));
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

type NavItem = SettingsNavItem;

const COLLAPSED_KEY = "kody.sidebar.collapsed";

export interface SidebarProps {
  account?: {
    label: string;
    imageUrl?: string;
    onSignOut: () => void;
  };
  /** Selects the persistent desktop rail or the mobile sheet presentation. */
  presentation?: "desktop" | "mobile";
  /** Called after a navigation action, allowing a mobile sheet to close. */
  onNavigate?: () => void;
  /**
   * Nav sections owned by the embedding host.
   */
  sections: readonly SettingsNavSection[];
  /** Host-owned pinned item above the section list, or null for none. */
  pinnedItem: SettingsNavItem | null;
  /** Product label next to the logo. */
  brandLabel?: string;
  /**
   * Optional slot rendered just below the brand header (e.g. a repo
   * switcher). Hidden while the rail is collapsed.
   */
  headerExtra?: React.ReactNode;
  /** Compact counterpart to `headerExtra`, rendered only while collapsed. */
  collapsedHeaderExtra?: React.ReactNode;
  /**
   * Optional slot at the right side of the brand row itself (e.g. a
   * notifications bell). Shown in its own centered row while collapsed.
   */
  brandRowExtra?: React.ReactNode;
  /** Optional action rendered above the scrollable navigation list. */
  navigationExtra?: React.ReactNode;
  /** Optional host controls rendered between navigation and the footer. */
  extras?: React.ReactNode;
  /** Optional host CTA rendered at the bottom of the sidebar. */
  bottomCta?: React.ReactNode;
  /** Optional footer action, shown above the app version. */
  onReportIssue?: () => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <Suspense fallback={null}>
      <SidebarContent {...props} />
    </Suspense>
  );
}

function SidebarContent({
  presentation = "desktop",
  onNavigate,
  sections: hostSections,
  pinnedItem,
  brandLabel = "Kody",
  headerExtra,
  collapsedHeaderExtra,
  brandRowExtra,
  navigationExtra,
  extras,
  bottomCta,
  onReportIssue,
  account,
}: SidebarProps) {
  const mobile = presentation === "mobile";
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const enableInboxBadgeData = shouldEnableSidebarInboxBadgeData(pathname);
  const enableMessagesBadgeData =
    shouldEnableSidebarMessagesBadgeData(pathname);
  const enableReportsBadgeData = shouldEnableSidebarReportsBadgeData(pathname);
  const { auth } = useAuth();
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity();
  const { theme, setTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [collapsedSearchOpen, setCollapsedSearchOpen] =
    useState<boolean>(false);
  const collapsedSearchInputRef = useRef<HTMLInputElement>(null);
  const baseSections = hostSections;
  const availableFavoriteItems = useMemo(() => {
    const items = new Map<string, SettingsNavItem>();
    for (const section of baseSections) {
      for (const item of section.items) {
        items.set(item.href, item);
      }
    }
    return [...items.values()];
  }, [baseSections]);
  const {
    favoriteHrefs,
    toggleFavorite,
    message: favoritesMessage,
  } = useNavigationFavorites(auth, availableFavoriteItems);
  const favoriteItems = useMemo(
    () => resolveFavoriteItems(favoriteHrefs, availableFavoriteItems),
    [availableFavoriteItems, favoriteHrefs],
  );
  const activeCollapsibleSectionTitle = useMemo(
    () => activeCollapsibleNavSectionTitle(baseSections, pathname, search),
    [baseSections, pathname, search],
  );
  const [expandedSectionTitle, setExpandedSectionTitle] = useState<
    string | null
  >(() => activeCollapsibleNavSectionTitle(baseSections, pathname, search));

  useEffect(() => {
    if (mobile) {
      setHydrated(true);
      return;
    }
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") {
        setCollapsed(true);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to defaults
    }
    setHydrated(true);
  }, [mobile]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore — UI still updates
      }
      return next;
    });
  };

  const scopedHref = (href: string, scope?: NavItem["scope"]) =>
    scope !== "personal" && auth?.owner && auth.repo
      ? repoScopedHref(auth, href)
      : href;

  useEffect(() => {
    setExpandedSectionTitle(activeCollapsibleSectionTitle);
  }, [activeCollapsibleSectionTitle]);

  useEffect(() => {
    if (!collapsedSearchOpen) return;
    const frame = requestAnimationFrame(() =>
      collapsedSearchInputRef.current?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [collapsedSearchOpen]);

  // Inline filter — narrows the rail's own sections by label/description as
  // the user types. Empty sections drop out so a query collapses the list to
  // just its matches.
  const isCollapsed = mobile ? false : collapsed;
  const width = isCollapsed ? "w-[72px]" : "w-[248px]";

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseSections;
    return baseSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          `${item.label} ${item.description ?? ""}`.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [baseSections, query]);

  const collapsedSearchItems = query.trim()
    ? filteredSections.flatMap((section) => section.items)
    : [];
  const repositorySectionIndex = filteredSections.findIndex(
    (section) => section.contextLabel === "Repository",
  );
  const repositorySelectorIndex =
    repositorySectionIndex === -1
      ? filteredSections.length
      : repositorySectionIndex;
  const repositorySelector = isCollapsed ? collapsedHeaderExtra : headerExtra;
  const firstMatch = collapsedSearchItems[0];

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setCollapsedSearchOpen(false);
    } else if (e.key === "Enter" && firstMatch) {
      e.preventDefault();
      e.currentTarget.blur();
      router.push(scopedHref(firstMatch.href, firstMatch.scope));
      setQuery("");
      setCollapsedSearchOpen(false);
      onNavigate?.();
    }
  };

  const renderLink = (
    item: NavItem,
    nested = false,
    favoritePlacement = false,
    favoriteable = true,
  ) => {
    const Icon = item.icon;
    const active = isNavItemActive(pathname, search, item);
    const favorite = favoriteHrefs.includes(item.href);
    const link = (
      <Link
        href={scopedHref(item.href, item.scope)}
        prefetch={item.href === "/" ? false : undefined}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-3.5 rounded-md text-body-sm transition-colors",
          "h-10 px-3.5",
          nested && "px-3",
          isCollapsed && "justify-center px-0",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <Icon className={cn("h-5 w-5 shrink-0", iconTintClass(item))} />
        {!isCollapsed && <span className="truncate">{item.label}</span>}
        {item.href === "/inbox" && (
          <InboxBadge
            enabled={enableInboxBadgeData}
            className={cn(isCollapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
        {item.href === "/messages" && (
          <MessagesBadge
            enabled={enableMessagesBadgeData}
            className={cn(isCollapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
        {item.href === "/reports" && (
          <ReportsBadge
            enabled={enableReportsBadgeData}
            className={cn(isCollapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
      </Link>
    );
    if (isCollapsed) {
      return (
        <SimpleTooltip key={item.href} content={item.label} side="right">
          {link}
        </SimpleTooltip>
      );
    }

    return (
      <div key={item.href} className="group flex min-w-0 items-center">
        {link}
        {favoriteable && (
          <button
            type="button"
            onClick={() => toggleFavorite(item.href)}
            aria-label={
              favorite
                ? `Remove ${item.label} from favorites`
                : `Add ${item.label} to favorites`
            }
            title={
              favorite
                ? `Remove ${item.label} from favorites`
                : `Add ${item.label} to favorites`
            }
            className={cn(
              "ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition",
              "hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              favorite || favoritePlacement
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Star
              className={cn(
                "h-4 w-4",
                favorite && "fill-amber-400 text-amber-400",
              )}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        mobile
          ? "flex w-full flex-col bg-black/30"
          : "hidden md:flex flex-col shrink-0 border-r border-white/[0.06] bg-black/30",
        "h-full min-h-0 overflow-hidden z-30 transition-[width] duration-150 ease-out",
        !mobile && width,
      )}
      aria-label="Primary navigation"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-white/[0.06] px-3.5",
          isCollapsed ? "justify-center" : "justify-between",
        )}
      >
        <SimpleTooltip
          content={APP_VERSION ? `Kody v${APP_VERSION}` : "Kody"}
          side="right"
        >
          <Link
            href={scopedHref("/")}
            prefetch={false}
            onClick={onNavigate}
            className="flex items-center gap-2 text-foreground hover:text-foreground/80"
            aria-label={
              APP_VERSION ? `Kody home (v${APP_VERSION})` : "Kody home"
            }
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-body-sm font-semibold text-white">
              K
            </div>
            {!isCollapsed && (
              <span className="truncate text-body-sm font-semibold tracking-tight">
                {brandLabel}
              </span>
            )}
          </Link>
        </SimpleTooltip>
        {brandRowExtra && !isCollapsed && (
          <div className="shrink-0">{brandRowExtra}</div>
        )}
      </div>

      {brandRowExtra && isCollapsed && (
        <div
          data-sidebar-collapsed-notifications="true"
          className="flex shrink-0 justify-center border-b border-white/[0.06] px-2.5 py-2"
        >
          {brandRowExtra}
        </div>
      )}

      <nav className="min-h-0 flex-1 flex flex-col py-3">
        <div
          data-sidebar-fixed-controls="true"
          className="shrink-0 space-y-1.5 px-2.5"
        >
          {pinnedItem && (
            <div className="pb-2">
              {renderLink(pinnedItem, false, false, false)}
            </div>
          )}

          {/* Inline search — filters the rail's own items as you type. Collapsed
              mode opens the same destinations in a floating picker. */}
          <div className="pb-1">
            {isCollapsed ? (
              <DropdownMenu
                open={collapsedSearchOpen}
                onOpenChange={(open) => {
                  setCollapsedSearchOpen(open);
                  if (!open) setQuery("");
                }}
              >
                <SimpleTooltip content="Search" side="right">
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Search"
                      className="flex h-10 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    >
                      <Search className="h-5 w-5 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="w-72"
                >
                  <DropdownMenuLabel className="text-muted-foreground">
                    Search navigation
                  </DropdownMenuLabel>
                  <div className="mx-1 mb-1 flex h-10 items-center gap-2 rounded-md border px-3">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      ref={collapsedSearchInputRef}
                      type="search"
                      name="kody-collapsed-navigation-search"
                      autoComplete="off"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        onSearchKeyDown(event);
                      }}
                      placeholder="Search pages…"
                      aria-label="Search navigation"
                      className="min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4 shrink-0" />
                      </button>
                    )}
                  </div>
                  {!query.trim() ? (
                    <p className="px-3 py-2 text-body-xs text-muted-foreground">
                      Type to find a page.
                    </p>
                  ) : collapsedSearchItems.length === 0 ? (
                    <p className="px-3 py-2 text-body-xs text-muted-foreground">
                      No matches.
                    </p>
                  ) : (
                    collapsedSearchItems.map((item) => {
                      const ItemIcon = item.icon;
                      const active = isNavItemActive(pathname, search, item);
                      return (
                        <DropdownMenuItem key={item.href} asChild>
                          <Link
                            href={scopedHref(item.href, item.scope)}
                            prefetch={item.href === "/" ? false : undefined}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "cursor-pointer gap-3",
                              active && "bg-accent text-foreground",
                            )}
                          >
                            <ItemIcon
                              className={cn(iconTintClass(item))}
                              aria-hidden="true"
                            />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex h-10 w-full items-center gap-2.5 rounded-md border border-white/[0.08] bg-black/20 px-3.5 text-body-sm transition-colors focus-within:border-white/[0.18]">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  type="search"
                  name="kody-navigation-search"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search…"
                  aria-label="Search navigation"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4 shrink-0" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {navigationExtra && (
          <div className="shrink-0 px-2.5 pb-2">{navigationExtra}</div>
        )}

        <div
          data-sidebar-scroll-list="true"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-4"
        >
          {!query.trim() && favoriteItems.length > 0 && (
            <section aria-label="Favorite pages" className="space-y-1 pb-2">
              <div className="space-y-1">
                {favoriteItems.map((item) => renderLink(item, false, true))}
              </div>
            </section>
          )}
          {favoritesMessage && !isCollapsed && (
            <p
              role="status"
              className="px-3.5 pb-2 text-body-xs text-muted-foreground"
            >
              {favoritesMessage}
            </p>
          )}
          {/* Nav sections — ordered by the main work loop, sourced from the
              shared settings-nav so new pages appear here automatically. Filtered
              live by the inline search; section headings show only when expanded,
              collapsed mode is a flat icon list. */}
          {filteredSections.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </p>
          ) : (
            filteredSections.map((section, i) => {
              const sectionId = `sidebar-section-${i}`;
              const Icon = section.icon;
              const sectionActive =
                activeCollapsibleSectionTitle === section.title;
              const showItems =
                !isCollapsed &&
                (!section.collapsible ||
                  Boolean(query.trim()) ||
                  expandedSectionTitle === section.title);

              return (
                <div key={section.title} className="space-y-1">
                  {section.contextLabel && !isCollapsed ? (
                    <p className="px-3.5 pb-1 pt-3 text-label font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {section.contextLabel}
                    </p>
                  ) : null}
                  {repositorySelector && i === repositorySelectorIndex ? (
                    <div
                      data-sidebar-repository-selector="true"
                      className={cn(
                        "pb-1 pt-2",
                        isCollapsed && "flex justify-center",
                      )}
                    >
                      {repositorySelector}
                    </div>
                  ) : null}
                  {section.collapsible ? (
                    isCollapsed ? (
                      <DropdownMenu>
                        <SimpleTooltip content={section.title} side="right">
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={section.title}
                              className={cn(
                                "flex h-10 w-full items-center justify-center rounded-md text-body-sm transition-colors",
                                sectionActive
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              )}
                            >
                              {Icon && (
                                <Icon
                                  className={cn(
                                    "h-5 w-5 shrink-0",
                                    iconTintClass(section),
                                  )}
                                />
                              )}
                            </button>
                          </DropdownMenuTrigger>
                        </SimpleTooltip>
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          sideOffset={8}
                          className="w-56"
                        >
                          <DropdownMenuLabel className="text-muted-foreground">
                            {section.title}
                          </DropdownMenuLabel>
                          {section.items.map((item) => {
                            const ItemIcon = item.icon;
                            const active = isNavItemActive(
                              pathname,
                              search,
                              item,
                            );
                            return (
                              <DropdownMenuItem key={item.href} asChild>
                                <Link
                                  href={scopedHref(item.href, item.scope)}
                                  prefetch={
                                    item.href === "/" ? false : undefined
                                  }
                                  onClick={onNavigate}
                                  aria-current={active ? "page" : undefined}
                                  className={cn(
                                    "cursor-pointer gap-3",
                                    active && "bg-accent text-foreground",
                                  )}
                                >
                                  <ItemIcon
                                    className={cn(iconTintClass(item))}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">{item.label}</span>
                                </Link>
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSectionTitle((current) =>
                            current === section.title ? null : section.title,
                          )
                        }
                        aria-controls={sectionId}
                        aria-expanded={showItems}
                        className={cn(
                          "flex h-10 w-full items-center gap-3.5 rounded-md px-3.5 text-body-sm transition-colors",
                          sectionActive
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        {Icon && (
                          <Icon
                            className={cn(
                              "h-5 w-5 shrink-0",
                              iconTintClass(section),
                            )}
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-left">
                          {section.title}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform",
                            !showItems && "-rotate-90",
                          )}
                        />
                      </button>
                    )
                  ) : !isCollapsed ? (
                    <p className="px-3.5 pb-1 pt-3.5 text-label font-semibold uppercase tracking-wider text-muted-foreground/80">
                      {section.title}
                    </p>
                  ) : null}
                  {section.collapsible && !isCollapsed ? (
                    <div
                      id={sectionId}
                      aria-hidden={!showItems}
                      inert={!showItems}
                      className={cn(
                        "grid transition-[grid-template-rows] duration-150 ease-out",
                        showItems ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="ml-3 space-y-1 border-l border-white/[0.08] py-1 pl-1">
                          {section.items.map((item) => renderLink(item, true))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    !isCollapsed &&
                    showItems && (
                      <div id={sectionId} className="space-y-1">
                        {section.items.map((item) =>
                          renderLink(item, Boolean(section.collapsible)),
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })
          )}
          {repositorySelector &&
          repositorySelectorIndex === filteredSections.length ? (
            <div
              data-sidebar-repository-selector="true"
              className={cn("pb-1 pt-2", isCollapsed && "flex justify-center")}
            >
              {repositorySelector}
            </div>
          ) : null}
        </div>
      </nav>

      {extras}

      <div className="space-y-1 border-t border-white/[0.06] p-2.5">
        {/* GitHub identity — click to reveal connected repo + sign out.
            Persistent app chrome, moved here from the page header. */}
        {(account || githubUser || connectedRepo) && (
          <div className="relative">
            <SimpleTooltip
              content={
                account
                  ? `${account.label}${connectedRepo ? ` · ${connectedRepo}` : ""}`
                  : githubUser
                    ? `@${githubUser.login}${connectedRepo ? ` · ${connectedRepo}` : ""}`
                    : (connectedRepo ?? "Connected")
              }
              side="right"
            >
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Account"
                className={cn(
                  "flex h-10 w-full items-center gap-3.5 rounded-md px-3.5 text-body-sm transition-colors",
                  "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  isCollapsed && "justify-center px-0",
                )}
              >
                {account || githubUser ? (
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarImage
                      src={account?.imageUrl ?? githubUser?.avatar_url}
                      alt={account?.label ?? githubUser?.login}
                    />
                    <AvatarFallback>
                      {(account?.label ??
                        githubUser?.login ??
                        "K")[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Github className="h-5 w-5 shrink-0" />
                )}
                {!isCollapsed && (
                  <span className="truncate flex-1 text-left">
                    {account?.label ??
                      (githubUser ? `@${githubUser.login}` : "Connected")}
                  </span>
                )}
              </button>
            </SimpleTooltip>
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-56 py-1 bg-popover border rounded-md shadow-lg z-50">
                {connectedRepo && (
                  <div className="mb-1 border-b px-3 py-2 text-body-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Repo:</span>{" "}
                    {connectedRepo}
                  </div>
                )}
                {account || githubUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      account?.onSignOut();
                      if (!account) clearGitHubUser();
                      setUserMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-sm hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    Sign out
                  </button>
                ) : (
                  <div className="px-3 py-2 text-body-xs text-muted-foreground">
                    No GitHub user signed in.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle — global chrome, moved here from the page header. */}
        <SimpleTooltip
          content={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          side="right"
        >
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className={cn(
              "flex h-10 w-full items-center gap-3.5 rounded-md px-3.5 text-body-sm",
              "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              isCollapsed && "justify-center px-0",
            )}
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5 shrink-0" />
            ) : (
              <Moon className="h-5 w-5 shrink-0" />
            )}
            {!isCollapsed && (
              <span className="truncate">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </span>
            )}
          </button>
        </SimpleTooltip>

        {!mobile && (
          <SimpleTooltip
            content={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            side="right"
          >
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "flex h-10 w-full items-center gap-3.5 rounded-md px-3.5 text-body-sm",
                "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                isCollapsed && "justify-center px-0",
              )}
            >
              {isCollapsed ? (
                <ChevronRight className="h-5 w-5 shrink-0" />
              ) : (
                <ChevronLeft className="h-5 w-5 shrink-0" />
              )}
              {!isCollapsed && <span className="truncate">Collapse</span>}
            </button>
          </SimpleTooltip>
        )}

        {onReportIssue && (
          <SimpleTooltip content="Report issue to Kody" side="right">
            <button
              type="button"
              onClick={onReportIssue}
              data-sidebar-report-issue="true"
              aria-label="Report issue to Kody"
              className={cn(
                "flex h-10 w-full items-center gap-3.5 rounded-md px-3.5 text-body-sm transition-colors",
                "text-destructive hover:bg-destructive/10 hover:text-destructive",
                isCollapsed && "justify-center px-0",
              )}
            >
              <Bug className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!isCollapsed && <span className="truncate">Report issue</span>}
            </button>
          </SimpleTooltip>
        )}

        {APP_VERSION && (
          <p
            data-sidebar-version="true"
            className="select-none px-1 pt-1 text-center font-mono text-code-sm text-muted-foreground/50"
          >
            v{APP_VERSION}
          </p>
        )}
      </div>

      {bottomCta && (
        <div className="shrink-0 border-t border-white/[0.08] bg-black/40 px-3 py-3">
          {bottomCta}
        </div>
      )}
    </aside>
  );
}
