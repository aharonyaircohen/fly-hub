/**
 * @fileType component
 * @domain preview
 * @pattern view-switcher-dropdown
 * @ai-summary Single-button dropdown for the user-configurable preview
 *   views (Web, Admin, + any the user adds). Replaces the prior bar of
 *   inline buttons that crowded the toolbar. Click the active-view button
 *   to open the picker; each row has a delete-on-hover; the bottom row
 *   is an inline "+ Add" form (name + relative path).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  ChevronDown,
  Check,
  Bookmark,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { Button } from "@kody-ade/base/ui/button";
import {
  addPreviewView,
  readPreviewViews,
  removePreviewView,
  writePreviewViews,
  type PreviewView,
} from "@dashboard/lib/preview-views";
import { useElementPicker } from "@dashboard/lib/picker/useElementPicker";
import { PreviewFloatingMenu } from "@dashboard/features/previews/components/PreviewFloatingMenu";

interface PreviewViewsBarProps {
  owner: string;
  repo: string;
  selectedId: string | null;
  onSelect: (view: PreviewView) => void;
  variant?: "toolbar" | "address";
}

export function PreviewViewsBar({
  owner,
  repo,
  selectedId,
  onSelect,
  variant = "toolbar",
}: PreviewViewsBarProps) {
  const [views, setViews] = useState<PreviewView[]>(() =>
    readPreviewViews(owner, repo),
  );
  // Inspector extension gives us a way to read the iframe's CURRENT URL —
  // crucial because the preview is usually cross-origin so we can't read
  // iframe.contentWindow.location.href ourselves.
  const picker = useElementPicker({ onSelect: () => {} });
  const resolveCurrentPath = async (): Promise<string | null> => {
    if (!picker.available) return null;
    const info = await picker.collectPage(400);
    if (!info?.url) return null;
    try {
      const u = new URL(info.url);
      return `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("/");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setViews(readPreviewViews(owner, repo));
  }, [owner, repo]);

  // Auto-select first when current selection vanishes.
  useEffect(() => {
    if (!selectedId && views.length > 0) onSelect(views[0]!);
    else if (selectedId && !views.find((v) => v.id === selectedId)) {
      if (views.length > 0) onSelect(views[0]!);
    }
  }, [selectedId, views, onSelect]);

  const closeMenu = (): void => {
    setMenuOpen(false);
    setAddOpen(false);
  };

  useEffect(() => {
    if (addOpen) nameInputRef.current?.focus();
  }, [addOpen]);

  const active = views.find((v) => v.id === selectedId) ?? views[0] ?? null;

  const persist = (next: PreviewView[]): void => {
    setViews(next);
    writePreviewViews(owner, repo, next);
  };

  const handleAdd = (): void => {
    const name = nameDraft.trim();
    if (!name) return;
    const next = addPreviewView(views, name, pathDraft);
    persist(next);
    onSelect(next[next.length - 1]!);
    setNameDraft("");
    setPathDraft("/");
    setAddOpen(false);
  };

  const handleRemove = (id: string): void => {
    if (views.length <= 1) return;
    persist(removePreviewView(views, id));
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="clear"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title="Switch preview view"
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors",
          variant === "address"
            ? "h-10 rounded-md px-2.5 text-zinc-300 hover:bg-white/[0.06] hover:text-white"
            : "rounded-md border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-400",
        )}
      >
        <span
          className={cn(
            "truncate",
            variant === "address" ? "max-w-[5rem]" : "max-w-[8rem]",
          )}
        >
          {active ? active.name : "View"}
        </span>
        <ChevronDown className="w-3 h-3" />
      </Button>

      <PreviewFloatingMenu
        open={menuOpen}
        anchorRef={rootRef}
        align="start"
        onClose={closeMenu}
        className="min-w-[14rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
      >
        <div role="listbox" aria-label="Preview views">
          {views.map((view) => {
            const selected = view.id === active?.id;
            return (
              <div
                key={view.id}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(view);
                    setMenuOpen(false);
                  }
                }}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 mx-1 rounded text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500/40",
                  selected
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-300 hover:bg-zinc-800",
                )}
                onClick={() => {
                  onSelect(view);
                  setMenuOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "w-3 h-3 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate font-medium">{view.name}</span>
                <span className="ml-auto truncate text-zinc-500 max-w-[6rem]">
                  {view.path}
                </span>
                {views.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(view.id);
                    }}
                    title={`Remove ${view.name}`}
                    aria-label={`Remove ${view.name}`}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:bg-transparent hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            );
          })}

          <div className="border-t border-zinc-800 mt-1 pt-1 px-1">
            {/* Quick actions backed by the inspector extension. Need it
                because the preview is usually cross-origin and we can't
                read iframe.contentWindow.location from the dashboard. */}
            {picker.available && !addOpen && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={async () => {
                    const path = await resolveCurrentPath();
                    setPathDraft(path ?? "/");
                    setNameDraft("");
                    setAddOpen(true);
                  }}
                  className="flex items-center justify-start gap-1.5 w-full px-2 py-1.5 text-xs font-normal text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 rounded"
                >
                  <Bookmark className="w-3 h-3" />
                  Save current view
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={async () => {
                    const info = await picker.collectPage(400);
                    const url = info?.url;
                    if (!url) {
                      toast.error("Couldn't read the preview URL");
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Copied preview URL");
                    } catch {
                      toast.error("Clipboard blocked — couldn't copy");
                    }
                    setMenuOpen(false);
                  }}
                  className="flex items-center justify-start gap-1.5 w-full px-2 py-1.5 text-xs font-normal text-zinc-300 hover:text-white hover:bg-zinc-800 rounded"
                >
                  <LinkIcon className="w-3 h-3" />
                  Copy current URL
                </Button>
              </>
            )}
            {addOpen ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAdd();
                }}
                className="flex items-center gap-1 px-1 py-1"
              >
                {/* eslint-disable-next-line react/forbid-elements -- compact bare inline input; kit Input's h-11/bg-form styling would visibly change it */}
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Name"
                  maxLength={32}
                  className="w-20 bg-zinc-800 text-xs text-white placeholder-zinc-500 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                {/* eslint-disable-next-line react/forbid-elements -- compact bare inline input; kit Input's h-11/bg-form styling would visibly change it */}
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  placeholder="/path"
                  maxLength={120}
                  className="flex-1 bg-zinc-800 text-xs text-white placeholder-zinc-500 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="clear"
                  className="text-xs font-normal text-emerald-400 hover:bg-transparent hover:text-emerald-300 px-1"
                  title="Add view"
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={() => {
                    setAddOpen(false);
                    setNameDraft("");
                    setPathDraft("/");
                  }}
                  className="text-xs text-zinc-500 hover:bg-transparent hover:text-zinc-300 px-1"
                  title="Cancel"
                >
                  <X className="w-3 h-3" />
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => setAddOpen(true)}
                className="flex items-center justify-start gap-1.5 w-full px-2 py-1.5 text-xs font-normal text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
              >
                <Plus className="w-3 h-3" />
                Add view
              </Button>
            )}
          </div>
        </div>
      </PreviewFloatingMenu>
    </div>
  );
}
