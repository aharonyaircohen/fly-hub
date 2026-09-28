import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fakeTool = () => ({
  description: "fixture",
  inputSchema: z.object({}),
  execute: vi.fn(async () => ({ ok: true })),
});

const createUserOctokitMock = vi.hoisted(() =>
  vi.fn(() => ({ kind: "octokit" })),
);
const createMacroToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ list_macros: fakeTool() })),
);
const createNotificationToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ list_notification_rules: fakeTool() })),
);
const createCompanyToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ export_company: fakeTool() })),
);
const createInboxToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ list_inbox: fakeTool() })),
);
const createRemoteToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ remote_implementation: fakeTool() })),
);
const createReportToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ list_reports: fakeTool() })),
);
const createAppsToolsMock = vi.hoisted(() =>
  vi.fn(() => ({ list_apps: fakeTool(), create_app: fakeTool() })),
);

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: createUserOctokitMock,
}));
vi.mock("../../../app/api/kody/chat/tools/macros-tools", () => ({
  createMacroTools: createMacroToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/notifications-tools", () => ({
  createNotificationTools: createNotificationToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/company-tools", () => ({
  createCompanyTools: createCompanyToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/inbox-tools", () => ({
  createInboxTools: createInboxToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/remote-tools", () => ({
  createRemoteTools: createRemoteToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/reports-tools", () => ({
  createReportTools: createReportToolsMock,
}));
vi.mock("../../../app/api/kody/chat/tools/apps-tools", () => ({
  createAppsTools: createAppsToolsMock,
}));

import { createDashboardHostTools } from "../../../app/api/kody/chat/kody/dashboard-host-tools";

describe("Dashboard chat host tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds live Dashboard tools from the request context", () => {
    const tools = createDashboardHostTools({
      owner: "acme",
      repo: "app",
      token: "ghp_test",
      extras: { actorLogin: "alice" },
    });

    expect(Object.keys(tools).sort()).toEqual([
      "create_app",
      "export_company",
      "list_apps",
      "list_inbox",
      "list_macros",
      "list_notification_rules",
      "list_reports",
      "remote_implementation",
    ]);
    expect(createUserOctokitMock).toHaveBeenCalledWith("ghp_test");
    expect(createMacroToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        actorLogin: "alice",
      }),
    );
    expect(createRemoteToolsMock).toHaveBeenCalledWith("alice");
    expect(createAppsToolsMock).toHaveBeenCalledWith({ token: "ghp_test", owner: "acme", repo: "app" });
  });
});
