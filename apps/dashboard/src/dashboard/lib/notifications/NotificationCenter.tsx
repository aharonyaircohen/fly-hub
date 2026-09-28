"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern notification-system
 * @ai-summary Dropdown notification center with unread badge, history, and preferences
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, Check, CheckCheck, Trash2, Settings, X } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import type { UseNotificationStoreReturn } from "./useNotificationStore";
import { NOTIFICATION_META } from "./types";
import type { NotificationType } from "./types";
import { NotificationPreferences } from "./NotificationPreferences";

interface NotificationCenterProps {
  store: UseNotificationStoreReturn;
  browserPermission: NotificationPermission;
  isSupported: boolean;
  onRequestPermission: () => void;
  /**
   * Popover placement: "header" (default) drops below, right-aligned;
   * "rail" opens as a flyout to the RIGHT of the sidepanel (fixed
   * position, so the rail's overflow-hidden can't clip it).
   */
  anchor?: "header" | "rail";
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationCenter({
  store,
  browserPermission,
  isSupported,
  onRequestPermission,
  anchor = "header",
}: NotificationCenterProps) {
  const [flyoutPos, setFlyoutPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setShowPrefs(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        setShowPrefs(false);
      }
    },
    [open],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
    removeNotification,
  } = store;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button with unread badge */}
      <Button
        type="button"
        variant="ghost"
        size="clear"
        onClick={(e) => {
          if (anchor === "rail" && !open) {
            const rect = e.currentTarget.getBoundingClientRect();
            setFlyoutPos({
              left: rect.right + 10,
              top: Math.max(8, rect.top - 4),
            });
          }
          setOpen(!open);
          setShowPrefs(false);
        }}
        className={cn(
          "relative p-1.5 rounded-md transition-colors",
          open
            ? "bg-muted text-foreground hover:bg-muted hover:text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-destructive-foreground bg-destructive rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown */}
      {open && (
        <div
          className={cn(
            "w-80 bg-background border rounded-lg shadow-xl z-50 overflow-hidden",
            anchor === "rail" ? "fixed" : "absolute right-0 top-full mt-1",
          )}
          style={
            anchor === "rail" && flyoutPos
              ? { left: flyoutPos.left, top: flyoutPos.top }
              : undefined
          }
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={markAllAsRead}
                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-transparent rounded transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={clearAll}
                  className="p-1 text-muted-foreground hover:text-destructive hover:bg-transparent rounded transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => setShowPrefs(!showPrefs)}
                className={cn(
                  "p-1 rounded transition-colors hover:bg-transparent",
                  showPrefs
                    ? "text-primary bg-primary/10 hover:bg-primary/10 hover:text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="Notification settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Preferences panel (slide-in) */}
          {showPrefs ? (
            <NotificationPreferences
              store={store}
              browserPermission={browserPermission}
              isSupported={isSupported}
              onRequestPermission={onRequestPermission}
              onClose={() => setShowPrefs(false)}
            />
          ) : (
            <>
              {/* Browser permission banner */}
              {isSupported && browserPermission !== "granted" && (
                <div className="px-3 py-2 bg-amber-500/10 border-b text-xs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="clear"
                    onClick={onRequestPermission}
                    className="whitespace-normal text-left justify-start font-normal text-xs rounded-none text-amber-600 dark:text-amber-400 hover:underline hover:bg-transparent hover:text-amber-600 dark:hover:text-amber-400"
                  >
                    {browserPermission === "denied"
                      ? "⚠️ Browser notifications blocked — check browser settings"
                      : "🔔 Enable browser notifications for background alerts"}
                  </Button>
                </div>
              )}

              {/* Notification list */}
              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>No notifications yet</p>
                    <p className="text-xs mt-1">
                      Task updates will appear here
                    </p>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const meta =
                      NOTIFICATION_META[notif.type as NotificationType];
                    return (
                      <div
                        key={notif.id}
                        className={cn(
                          "flex items-start gap-2 px-3 py-2.5 border-b last:border-b-0 transition-colors cursor-pointer hover:bg-muted/50",
                          !notif.read && "bg-primary/5",
                        )}
                        onClick={() => markAsRead(notif.id)}
                      >
                        {/* Icon */}
                        <span className="text-base mt-0.5 shrink-0">
                          {meta?.icon ?? "📌"}
                        </span>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={cn(
                                "text-xs font-medium truncate",
                                !notif.read && "text-foreground",
                                notif.read && "text-muted-foreground",
                              )}
                            >
                              {notif.title.replace(/^[^\s]+ /, "")}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {timeAgo(notif.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.body}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {!notif.read && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="clear"
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsRead(notif.id);
                              }}
                              className="p-0.5 text-muted-foreground hover:text-primary hover:bg-transparent rounded"
                              title="Mark as read"
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="clear"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeNotification(notif.id);
                            }}
                            className="p-0.5 text-muted-foreground hover:text-destructive hover:bg-transparent rounded"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
