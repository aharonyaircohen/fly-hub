/**
 * @fileType component
 * @domain chat-plugin-languages
 * @pattern page-plugin-panel
 * @ai-summary Languages panel view. Renders the SAME tree the route renders.
 *   The wrapper is only a stable marker for the flipped shell and adds no
 *   layout.
 */
"use client";

import { LanguagesManager } from "../../../components/LanguagesManager";

export const LANGUAGES_PANEL_TESTID = "chat-panel-languages";

export function LanguagesPanelView() {
  return (
    <div data-testid={LANGUAGES_PANEL_TESTID} className="contents">
      <LanguagesManager />
    </div>
  );
}
