"use client";

import { ThemesManager } from "../../../components/ThemesManager";

export const THEMES_PANEL_TESTID = "chat-panel-themes";

export function ThemesPanelView() {
  return (
    <div data-testid={THEMES_PANEL_TESTID} className="contents">
      <ThemesManager />
    </div>
  );
}
