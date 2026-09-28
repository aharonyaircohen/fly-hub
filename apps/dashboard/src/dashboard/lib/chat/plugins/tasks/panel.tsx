/**
 * @fileType component
 * @domain chat-plugin-tasks
 * @pattern plugin-panel-view
 * @ai-summary Tasks panel view (phase 2 step 3 pilot). Renders the SAME
 *   tree the /tasks route renders (`AuthGate` → AuthGuard → KodyDashboard)
 *   — the plugin WRAPS the page component, it does not fork it. The
 *   `display: contents` wrapper exists only as a stable marker proving the
 *   flipped shell rendered the plugin's view (not the raw route children);
 *   it adds no layout of its own, so the rendered board is byte-identical
 *   to the route's.
 *
 *   Settings surface: the tasks page has no separate settings UI — its
 *   filters/search/status controls live INSIDE KodyDashboard's own header,
 *   which renders here unchanged. That in-board chrome IS the plugin's
 *   settings surface this step.
 */
"use client";

import { AuthGate } from "../../../components/AuthGate";
import type { ChatPanelViewProps } from "@kody-ade/kody-chat-dashboard/platform";

export const TASKS_PANEL_TESTID = "chat-panel-tasks";

export function TasksPanelView(_props: ChatPanelViewProps) {
  return (
    <div className="contents" data-testid={TASKS_PANEL_TESTID}>
      <AuthGate />
    </div>
  );
}
