import { describe, expect, it } from "vitest";
import {
  DASHBOARD_NAVIGATION_TARGETS,
  dashboardNavigationCatalogForPrompt,
  resolveDashboardNavigationTarget,
} from "../../src/dashboard/lib/dashboard-navigation";

describe("dashboard navigation catalog", () => {
  it("derives known dashboard pages from the shared nav source", () => {
    expect(DASHBOARD_NAVIGATION_TARGETS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: "secrets",
          href: "/secrets",
          label: "Secrets",
        }),
        expect.objectContaining({
          routeId: "models",
          href: "/models",
          label: "Chat Models",
        }),
        expect.objectContaining({
          routeId: "connections",
          href: "/connections",
          label: "Connections",
        }),
        expect.objectContaining({
          routeId: "findings",
          href: "/findings",
          label: "Findings",
        }),
        expect.objectContaining({
          routeId: "task",
          href: "/:issueNumber",
          parameters: [
            expect.objectContaining({
              key: "issueNumber",
              label: "Task number",
            }),
          ],
        }),
      ]),
    );
  });

  it("prints model-facing route ids and intent hints", () => {
    const catalog = dashboardNavigationCatalogForPrompt();

    expect(catalog).toContain("secrets: Secrets -> /secrets");
    expect(catalog).toContain("connections: Connections -> /connections");
    expect(catalog).toContain("Aliases: secret, secrets, vault");
    expect(catalog).toContain(
      "Aliases: connection, connections, external account, provider connection, facebook page api",
    );
    expect(catalog).not.toContain(
      "Aliases: connection, connections, facebook, facebook page, social publishing",
    );
    expect(catalog).toContain("task: Task detail -> /:issueNumber");
  });

  it("resolves a static route id to an internal href", () => {
    expect(
      resolveDashboardNavigationTarget({
        routeId: "secrets",
        reason: "Opening the secrets vault.",
      }),
    ).toEqual({
      routeId: "secrets",
      href: "/secrets",
      label: "Secrets",
      reason: "Opening the secrets vault.",
    });
  });

  it("requires an issue number for task detail navigation", () => {
    expect(
      resolveDashboardNavigationTarget({
        routeId: "task",
        reason: "Opening the task.",
      }),
    ).toEqual({ error: "Task navigation requires a positive issueNumber." });

    expect(
      resolveDashboardNavigationTarget({
        routeId: "task",
        parameters: { issueNumber: "123" },
        reason: "Opening task 123.",
      }),
    ).toEqual({
      routeId: "task",
      href: "/123",
      label: "Task #123",
      reason: "Opening task 123.",
    });
  });
});
