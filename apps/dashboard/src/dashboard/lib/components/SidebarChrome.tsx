/**
 * @fileType component
 * @domain layout
 * @pattern sidebar-chrome
 * @ai-summary The dashboard's sidepanel-header extensions: a notifications
 *   bell for the shared Sidebar's brand row (top), while the shell's default
 *   repo switcher fills the row below. Rendered inside NotificationsProvider
 *   (the shell sits under the providers in ChatRailShell).
 */
"use client";

import { NotificationCenter } from "../notifications/NotificationCenter";
import { useNotifications } from "../notifications/NotificationsProvider";

export function SidebarNotifications() {
  const { store, permission, isSupported, requestPermission } =
    useNotifications();

  return (
    <NotificationCenter
      anchor="rail"
      store={store}
      browserPermission={permission}
      isSupported={isSupported}
      onRequestPermission={requestPermission}
    />
  );
}
