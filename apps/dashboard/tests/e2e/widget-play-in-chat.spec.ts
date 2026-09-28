import { expect, test, type Page, type Route } from "@playwright/test";
import { openChatSetupSection } from "./support/chat-setup";

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

function sseBody(events: unknown[]): string {
  return (
    [...events, { type: "finish" }]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(
        `${response.request().method()} ${new URL(response.url()).pathname} (${response.status()})`,
      );
    }
  });
  return errors;
}

async function mockQuestionWidget(page: Page) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
    window.localStorage.setItem(
      "kody-default-chat-entry:acme/widgets",
      "kody:widget-model",
    );
    window.localStorage.removeItem("kody-sessions-v3:acme/widgets");
    window.localStorage.removeItem("kody-sessions-v3");
  }, auth);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isCollection = pathname.endsWith("/conversations");
    if (request.method() === "GET" && isCollection) {
      return json(route, { conversations: [] });
    }
    return json(
      route,
      request.method() === "GET"
        ? {
            conversation: null,
            entries: [],
            checkpoints: [],
            runtimeBindings: [],
            attachments: [],
          }
        : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/commands**", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/agents**", (route) =>
    json(route, { agent: [] }),
  );
  await page.route("**/api/kody/guided-flows**", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/models**", (route) =>
    json(route, {
      models: [
        {
          id: "widget-model",
          provider: "example",
          modelName: "widget-model",
          label: "Widget Model",
          apiKeySecret: "WIDGET_MODEL_KEY",
          baseURL: "https://example.test/v1",
          protocol: "openai",
          enabled: true,
        },
      ],
    }),
  );
  await page.route("**/api/kody/widgets/question-select?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        export const previewData = {
          documentId: "question-1"
        };
        export default function mount(element, props) {
          let disposed = false;
          props.cms.get("quiz-items", props.data.documentId).then((question) => {
            if (disposed) return;
            const section = document.createElement("section");
            section.setAttribute("aria-label", question.title);
            const prompt = document.createElement("p");
            prompt.textContent = question.prompt;
            section.appendChild(prompt);
            for (const option of question.options) {
              const button = document.createElement("button");
              button.textContent = option.label;
              button.onclick = () => {
                if (!option.correct) {
                  props.kody.postToChat({ content: question.hint });
                  return;
                }
                props.kody.postToChat({ content: question.solution });
                props.kody.submitResult({
                  actionId: "correct",
                  data: { selectedOptionId: option.id }
                });
              };
              section.appendChild(button);
            }
            const askButton = document.createElement("button");
            askButton.textContent = "Ask Kody why";
            askButton.onclick = () => props.kody.sendToKody({
              message: question.explanationPrompt
            });
            section.appendChild(askButton);
            element.replaceChildren(section);
          });
          return () => {
            disposed = true;
            element.replaceChildren();
          };
        }
      `,
    }),
  );
  await page.route("**/api/kody/cms/quiz-items/question-1", (route) =>
    json(route, {
      document: {
        _id: "question-1",
        title: "Widget-owned preview",
        prompt: "What is 3 + 4?",
        hint: "Count forward from three.",
        solution: "Correct — the answer is seven.",
        explanationPrompt: "Explain why three plus four equals seven.",
        options: [
          { id: "six", label: "6" },
          { id: "seven", label: "7", correct: true },
        ],
      },
    }),
  );
  await page.route("**/api/kody/widgets", (route) =>
    json(route, {
      widgets: [
        {
          tenantId: "acme/widgets",
          name: "Question Select",
          slug: "question-select",
          version: 4,
          bundleSize: 1_024,
          updatedAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    }),
  );
}

function guidedWidgetView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "guided-widget-view",
    rendererSlug: "question-select",
    rendererName: "Question select",
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: "guided-widget-instance",
      stepId: "question",
      revision: 0,
    },
    ui: {
      type: "widget",
      widget: "question-select",
      data: { documentId: "question-1" },
    },
    data: {},
  };
}

test("plays a tenant widget directly in Chat without starting a Guided Flow", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await mockQuestionWidget(page);
  let modelTurns = 0;
  let modelMessage = "";
  await page.route("**/api/kody/chat/kody", (route) => {
    modelTurns += 1;
    const body = route.request().postDataJSON() as {
      messages?: Array<{ content?: string }>;
    };
    modelMessage = body.messages?.at(-1)?.content ?? "";
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: sseBody([
        { type: "text-delta", delta: "Three and four more make seven." },
      ]),
    });
  });
  await page.goto("/repo/acme/widgets/views/widgets", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: /question-select/ }).click();
  await expect(page).toHaveURL(
    "/repo/acme/widgets/views/widgets/question-select",
  );

  const play = page.getByRole("button", {
    name: "Play Question Select in Chat",
  });
  await play.click();

  const widget = page.getByRole("region", { name: "Widget-owned preview" });
  await expect(widget).toContainText("What is 3 + 4?");
  await widget.getByRole("button", { name: "6", exact: true }).click();
  expect(browserErrors).toEqual([]);
  await expect(page.getByText("Count forward from three.")).toBeVisible();
  await expect(widget).toBeVisible();
  const chat = page.locator('[aria-label="Kody chat"]').first();
  const setup = chat.getByLabel("Chat setup").first();
  const modelMenu = await openChatSetupSection(chat, "Model");
  await modelMenu
    .locator('button[role="option"]')
    .filter({ hasText: "Widget Model" })
    .click();
  await expect(setup).toHaveAttribute("title", /Widget Model/);

  await widget.getByRole("button", { name: "Ask Kody why" }).click();
  await expect(page.getByText("Three and four more make seven.")).toBeVisible();
  expect(modelTurns).toBe(1);
  expect(modelMessage).toContain("Explain why three plus four equals seven.");

  await widget.getByRole("button", { name: "7", exact: true }).click();
  await expect(page.getByText("Correct — the answer is seven.")).toBeVisible();
  await expect(page).toHaveURL(
    "/repo/acme/widgets/views/widgets/question-select",
  );
  expect(modelTurns).toBe(1);
  await expect(
    page.getByText("GuidedFlow started. Follow the steps below."),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("plays a widget in the newly opened conversation", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await mockQuestionWidget(page);
  await page.goto("/repo/acme/widgets/views/widgets", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: /question-select/ }).click();

  const play = page.getByRole("button", {
    name: "Play Question Select in Chat",
  });
  const widget = page.getByRole("region", { name: "Widget-owned preview" });

  await play.click();
  await expect(widget).toBeVisible();

  await page.evaluate(() => {
    const newConversation = document.querySelector<HTMLButtonElement>(
      'button[aria-label="New conversation"]',
    );
    if (!newConversation) {
      throw new Error("Widget launch controls are unavailable");
    }
    newConversation.click();
    const playWidget = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Play Question Select in Chat"]',
    );
    if (!playWidget) throw new Error("Widget launch control is unavailable");
    playWidget.click();
  });

  await expect(widget).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("mounts the same independent widget inside a Guided Flow", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await mockQuestionWidget(page);
  await page.route("**/api/kody/guided-flows", async (route) => {
    if (route.request().method() === "GET") {
      return json(route, { flows: [] });
    }
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action === "start") {
      return json(route, {
        view: guidedWidgetView(),
        instance: { instanceId: "guided-widget-instance", status: "active" },
      });
    }
    return json(route, {
      instance: { instanceId: "guided-widget-instance", status: "completed" },
    });
  });

  await page.goto(
    "/repo/acme/widgets/chat?guidedFlow=widget-lesson&instanceKey=student-1",
    { waitUntil: "domcontentloaded" },
  );

  await expect(
    page.getByText("GuidedFlow started. Follow the steps below."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Widget-owned preview" }),
  ).toContainText("What is 3 + 4?");

  await page.getByRole("button", { name: "6" }).click();
  await expect(page.getByText("Count forward from three.")).toBeVisible();
  await page.getByRole("button", { name: "7" }).click();

  await expect(page.getByText("Correct — the answer is seven.")).toBeVisible();
  await expect(page.getByText("GuidedFlow completed.")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
