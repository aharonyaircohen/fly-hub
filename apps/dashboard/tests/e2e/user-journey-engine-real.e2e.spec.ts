import { expect, test } from "@playwright/test";
import {
  runJourneyScenario,
  type JourneyBrowserPage,
} from "@kody-ade/kody-chat-dashboard/user-journeys/runner";
import type { JourneyScenario } from "@kody-ade/kody-chat-dashboard/user-journeys/contracts";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

test("executes a journey scenario against the real Dashboard DOM", async ({
  page,
}) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: { login: "e2e-test", avatar_url: "", githubId: 1 },
      }),
    }),
  );
  await page.route("**/api/kody/quality/journeys**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actions: [],
        journeys: [],
        scenarios: [],
        runs: [],
        currentSourceCommit: null,
      }),
    }),
  );

  const scenario: JourneyScenario = {
    id: "manage-page",
    name: "Manage page",
    kind: "happy",
    steps: [
      {
        id: "open",
        action: {
          type: "navigate",
          url: "/repo/acme/widgets/quality/journeys",
        },
        assertions: [
          {
            type: "visible",
            locator: { by: "role", role: "heading", name: "Journeys" },
          },
        ],
      },
      {
        id: "new",
        action: {
          type: "click",
          locator: { by: "label", label: "New journey" },
        },
        assertions: [
          {
            type: "visible",
            locator: {
              by: "role",
              role: "heading",
              name: "New journey",
            },
          },
        ],
      },
    ],
  };

  const result = await runJourneyScenario(
    page as unknown as JourneyBrowserPage,
    scenario,
  );

  expect(result.status).toBe("passed");
  expect(result.steps).toHaveLength(2);
  await expect(page).toHaveURL(/\/repo\/acme\/widgets\/quality\/journeys$/);
});
