import { expect, test, type Route } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function providerChoiceView(stepId: string, revision: number) {
  return {
    action: "render_view",
    view: "renderer",
    id: `provider-choice-${revision}`,
    rendererSlug: "approval-card",
    rendererName: "Approval card",
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: "provider-branch-instance",
      stepId,
      revision,
    },
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Set up Chat", variant: "title" },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Set up OpenRouter",
              action: {
                id: "openrouter",
                label: "Set up OpenRouter",
                response: "openrouter",
                variant: "primary",
              },
            },
            {
              type: "button",
              label: "Set up xKiro",
              action: {
                id: "xkiro",
                label: "Set up xKiro",
                response: "xkiro",
                variant: "secondary",
              },
            },
            {
              type: "button",
              label: "Skip for now",
              action: {
                id: "skip",
                label: "Skip for now",
                response: "skip",
                variant: "secondary",
              },
            },
          ],
        },
      ],
    },
    data: { title: "Set up Chat" },
  };
}

test("branches from the provider step to xKiro setup", async ({ page }) => {
  let submittedSteps = 0;
  await page.addInitScript(
    (value) => window.localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await mockKodyAccountSession(page);
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const isCollection = new URL(route.request().url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      route.request().method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      route.request().method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [{ id: "test/model", label: "Test", enabled: true }] }),
  );
  await page.route("**/api/kody/orgs/**/repos", (route) =>
    json(route, { organizations: ["acme"], repositories: [] }),
  );
  await page.route("**/api/kody/secrets", (route) =>
    json(route, { secrets: [] }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "GET") {
      return json(route, {
        definitions: [
          { id: "onboarding", title: "Get started with Kody", steps: [] },
        ],
        flows: [],
      });
    }
    const body = route.request().postDataJSON() as {
      action?: string;
      stepId?: string;
    };
    if (body.action === "start") {
      return json(
        route,
        {
          instance: { status: "active" },
          compatibility: { status: "compatible" },
          view: providerChoiceView("choose-chat-provider", 0),
        },
        201,
      );
    }
    submittedSteps += 1;
    if (submittedSteps === 1) {
      expect(body.stepId).toBe("choose-chat-provider");
      return json(route, {
        instance: { status: "active" },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "verify-xkiro-2",
          rendererSlug: "guided-flow-command",
          rendererName: "Guided Flow command",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "provider-branch-instance",
            stepId: "verify-xkiro",
            revision: 2,
          },
          data: {
            title: "Verify xKiro Chat",
            command: "/check-chat xkiro/deepseek/deepseek-v4-flash",
            status: "ready",
            actions: [
              {
                id: "run",
                label: "Run command",
                response: "run",
                variant: "primary",
              },
            ],
          },
          ui: {
            type: "stack",
            children: [
              { type: "text", value: "Verify xKiro Chat", variant: "title" },
              {
                type: "button",
                label: "Run command",
                action: {
                  id: "run",
                  label: "Run command",
                  response: "run",
                  variant: "primary",
                },
              },
            ],
          },
        },
      });
    }
    expect(body.stepId).toBe("choose-chat-provider");
    return json(route, {
      instance: { status: "active" },
      compatibility: { status: "compatible" },
      view: {
        ...providerChoiceView("add-xkiro-key", 1),
        ui: {
          type: "stack",
          children: [
            { type: "text", value: "Activate xKiro Free", variant: "title" },
            { type: "text", value: "XKIRO_API_KEY", variant: "body" },
            {
              type: "button",
              label: "Continue",
              action: {
                id: "next",
                label: "Continue",
                response: "next",
                variant: "primary",
              },
            },
          ],
        },
      },
      navigation: {
        action: "dashboard_navigate",
        routeId: "secrets",
        href: "/secrets",
        label: "Secrets",
        reason: "Open Add your xKiro key",
      },
    });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Start Get started with Kody in Chat" })
    .click();

  const chat = page.locator('[aria-label="Kody chat"]');
  await expect(
    chat.getByRole("button", { name: "Set up OpenRouter", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Set up xKiro", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Skip for now", exact: true }),
  ).toBeVisible();
  await chat.getByRole("button", { name: "Set up xKiro", exact: true }).click();
  await expect(page.getByText("Verify xKiro Chat", { exact: true })).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Run command", exact: true }),
  ).toBeVisible();
});
