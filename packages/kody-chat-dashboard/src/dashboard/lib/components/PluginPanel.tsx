/**
 * @fileType component
 * @domain kody-chat
 * @pattern plugin-panel-host
 * @ai-summary Renders one panel view contributed by a ChatPlugin. Shell page
 *   routes use this to mount their plugin's panel as the routed content.
 */
"use client";

import { useMemo } from "react";
import type { ChatPlugin } from "../chat/platform/types";

const EMPTY_HOST: Readonly<Record<string, unknown>> = Object.freeze({});

export function PluginPanel({
  plugin,
  panelId,
}: {
  plugin: ChatPlugin;
  panelId: string;
}) {
  const panel = useMemo(
    () => plugin.panels?.find((entry) => entry.id === panelId) ?? null,
    [plugin, panelId],
  );
  if (!panel) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Panel “{panelId}” is not registered.
      </div>
    );
  }
  const Panel = panel.render;
  return <Panel host={EMPTY_HOST} />;
}
