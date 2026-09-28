import { describe, expect, it } from "vitest";

import { terminalStartupIssue } from "../../../src/dashboard/lib/chat/plugins/terminal/terminal-startup-issue";

describe("terminalStartupIssue", () => {
  it("offers setup only when the Brain runtime is missing terminal support", () => {
    expect(
      terminalStartupIssue({
        code: "terminal_gateway_not_ready",
        message: "Terminal gateway is not deployed for this Brain runtime.",
        action: "setup",
      }),
    ).toEqual({
      title: "Terminal setup required",
      message: "Terminal gateway is not deployed for this Brain runtime.",
      action: "setup",
      actionLabel: "Set up terminal",
    });
  });

  it("directs authorization failures to repository Secrets", () => {
    expect(
      terminalStartupIssue({
        code: "fly_access_denied",
        message: "Fly token cannot access this Brain app.",
        action: "settings",
      }),
    ).toMatchObject({
      title: "Brain access needs attention",
      action: "settings",
      actionLabel: "Open Secrets",
    });
  });

  it("uses a normal retry for temporary connection failures", () => {
    expect(
      terminalStartupIssue({
        code: "terminal_session_failed",
        message: "Temporary failure",
        action: "retry",
      }),
    ).toMatchObject({
      title: "Terminal could not connect",
      action: "retry",
      actionLabel: "Try again",
    });
  });
});
