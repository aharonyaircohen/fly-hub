import type {
  TerminalStartupAction,
  TerminalStartupIssue,
} from "./terminal-session-client";

export interface VisibleTerminalStartupIssue {
  title: string;
  message: string;
  action: TerminalStartupAction;
  actionLabel: string;
}

export function terminalStartupIssue(
  issue: TerminalStartupIssue | null,
): VisibleTerminalStartupIssue | null {
  if (!issue) return null;
  if (issue.action === "setup") {
    return {
      title: "Terminal setup required",
      message: issue.message,
      action: "setup",
      actionLabel: "Set up terminal",
    };
  }
  if (issue.action === "settings") {
    return {
      title: "Brain access needs attention",
      message: issue.message,
      action: "settings",
      actionLabel: "Open Secrets",
    };
  }
  return {
    title: "Terminal could not connect",
    message: issue.message,
    action: "retry",
    actionLabel: "Try again",
  };
}
