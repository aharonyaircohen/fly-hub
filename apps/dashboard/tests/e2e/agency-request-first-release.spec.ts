import { expect, test, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "agency-e2e";
const REPO = "workspace";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
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

function approvalView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "agency-request-keep-ci-passing",
    rendererSlug: "approval-card",
    rendererName: "Approval card",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        {
          type: "text",
          value: "Approve this Agency plan?",
          variant: "title",
        },
        {
          type: "text",
          value:
            "Kody saved the verified plan and boundaries on the Agency request Todo.",
        },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Approve",
              action: {
                id: "approve",
                label: "Approve",
                response: "approve",
                variant: "primary",
              },
            },
            {
              type: "button",
              label: "Cancel",
              action: {
                id: "cancel",
                label: "Cancel",
                response: "cancel",
              },
            },
          ],
        },
      ],
    },
    data: {},
  };
}

function view(
  stepId: string,
  revision: number,
  field?: {
    name: string;
    label: string;
    submitLabel: string;
  },
) {
  const isIntroduction = !field;
  return {
    action: "render_view",
    view: "renderer",
    id: `agency-request-${revision}`,
    rendererSlug: isIntroduction ? "approval-card" : "guided-form",
    rendererName: isIntroduction ? "Approval card" : "Guided form",
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: "agency-request-instance",
      stepId,
      revision,
    },
    ui: isIntroduction
      ? {
          type: "stack",
          children: [
            {
              type: "text",
              value: "Create an Agency request",
              variant: "title",
            },
            {
              type: "button",
              label: "Begin",
              action: {
                id: "continue",
                label: "Begin",
                response: "continue",
                variant: "primary",
              },
            },
          ],
        }
      : {
          type: "stack",
          children: [
            { type: "text", value: field.label, variant: "title" },
            {
              type: "input",
              name: field.name,
              label: field.label,
              value: "",
              inputType: "textarea",
              readOnly: false,
            },
            { type: "submit", label: field.submitLabel },
          ],
        },
    data: {},
  };
}

test("collects, approves, and starts an Agency request", async ({ page }) => {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "agency-e2e-token",
          user: { login: "agency-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "agency-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [], turns: [] }),
  );
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Test model", enabled: true }],
    }),
  );

  const fields = [
    ["desired-outcome", "desiredOutcome", "What should Kody achieve?"],
    ["activation", "activation", "When should Kody act?"],
    ["allowed-actions", "allowedActions", "What may Kody change?"],
    ["success-criteria", "successCriteria", "What proves success?"],
    [
      "additional-context",
      "additionalContext",
      "Anything else Kody should consider?",
    ],
  ] as const;
  let startedInstanceKey = "";
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") return json(route, { flows: [] });
    const body = route.request().postDataJSON() as {
      action?: string;
      stepId?: string;
      instanceKey?: string;
    };
    if (body.action === "start") {
      startedInstanceKey = body.instanceKey ?? "";
      return json(route, {
        instance: { status: "active" },
        flow: { id: "new-agency-request" },
        view: view("introduction", 0),
      });
    }
    const currentIndex = fields.findIndex(([stepId]) => stepId === body.stepId);
    if (body.stepId === "introduction" || currentIndex < fields.length - 1) {
      const nextIndex = body.stepId === "introduction" ? 0 : currentIndex + 1;
      const [stepId, name, label] = fields[nextIndex]!;
      return json(route, {
        instance: { status: "active" },
        flow: { id: "new-agency-request" },
        view: view(stepId, nextIndex + 1, {
          name,
          label,
          submitLabel:
            nextIndex === fields.length - 1 ? "Submit request" : "Continue",
        }),
      });
    }
    return json(route, {
      instance: { status: "completed" },
      flow: { id: "new-agency-request" },
      handoff: {
        type: "kody",
        displayContent: "Request submitted for assessment.",
        message: 'Assess Agency Todo "keep-ci-passing" now.',
      },
    });
  });

  const chatMessages: string[] = [];
  await page.route("**/api/kody/chat/kody", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ content?: string }>;
    };
    const latest = body.messages?.at(-1)?.content ?? "";
    chatMessages.push(latest);
    const approved = latest.includes("<view_result>");
    const output = approved
      ? {
          content:
            "Agency request started as workflow run run-1 and is being monitored.",
        }
      : approvalView();
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseBody([
        {
          type: "tool-input-available",
          toolCallId: approved ? "final-run" : "approval-view",
          toolName: approved ? "final_answer" : "show_view",
          input: approved ? output : { purpose: "agency-request-approval" },
        },
        {
          type: "tool-output-available",
          toolCallId: approved ? "final-run" : "approval-view",
          output,
        },
      ]),
    });
  });

  await page.goto(
    `/repo/${OWNER}/${REPO}/chat?guidedFlow=new-agency-request&instanceKey=blueprint:healthy-ci`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByText("Create an Agency request")).toBeVisible();
  expect(startedInstanceKey).toBe("blueprint:healthy-ci");
  await page.getByRole("button", { name: "Begin" }).click();

  const answers = [
    "Keep CI passing",
    "When a GitHub Actions run fails",
    "Create a branch and pull request; do not merge",
    "All failed checks pass",
    "Use the installed CI Repair solution",
  ];
  for (let index = 0; index < fields.length; index += 1) {
    const [, , label] = fields[index]!;
    await page.getByRole("textbox", { name: label }).fill(answers[index]!);
    await page
      .locator('[aria-label="Kody chat"] button:enabled')
      .filter({
        hasText: index === fields.length - 1 ? "Submit request" : "Continue",
      })
      .last()
      .click();
  }

  await expect(
    page.getByText("Request submitted for assessment."),
  ).toBeVisible();
  await expect(page.getByText("Approve this Agency plan?")).toBeVisible();
  expect(chatMessages[0]).toBe('Assess Agency Todo "keep-ci-passing" now.');

  await page.getByRole("button", { name: "Approve" }).click();

  await expect(
    page.getByText(
      "Agency request started as workflow run run-1 and is being monitored.",
    ),
  ).toBeVisible();
  expect(chatMessages[1]).toContain("<view_result>");
  expect(chatMessages[1]).toContain(
    '"viewId":"agency-request-keep-ci-passing"',
  );
  expect(chatMessages[1]).toContain('"actionId":"approve"');
});

test("shows the completed Blueprint checklist and Report link on its Todo", async ({
  page,
}) => {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "agency-e2e-token",
          user: { login: "agency-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "agency-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/todos", (route) =>
    json(route, {
      todos: [
        {
          slug: "healthy-ci",
          path: "todos/healthy-ci.json",
          title: "Build Healthy CI",
          description: "Kody completed this request and recorded its evidence.",
          items: [
            "Validate the request and Blueprint",
            "Prepare the repository-specific plan",
            "Activate the required automation",
            "Run the Blueprint Workflow",
            "Verify the result end to end",
            "Publish the completion report",
          ].map((title, index) => ({
            id: `request-${index + 1}`,
            title,
            body: "Completed by the Agency request.",
            assignee: null,
            completed: true,
            createdAt: "2026-08-14T10:00:00.000Z",
            completedAt: "2026-08-14T10:30:00.000Z",
          })),
          createdAt: "2026-08-14T10:00:00.000Z",
          updatedAt: "2026-08-14T10:30:00.000Z",
          sha: "",
          htmlUrl: "",
          agencyRequest: {
            phase: "done",
            source: {
              kind: "store-blueprint",
              blueprintId: "healthy-ci",
              requestId: "request-2",
            },
            requirement: { outcome: "Build Healthy CI" },
            questions: [],
            plan: ["Apply Healthy CI"],
            evidence: ["Repository CI passed"],
            blockers: [],
            related: [
              { kind: "strategy", id: "healthy-ci" },
              { kind: "run", id: "run-123" },
              { kind: "report", id: "agency-request-healthy-ci" },
            ],
          },
        },
      ],
    }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/todos`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByText("Build Healthy CI", { exact: true }).click();
  await expect(page.getByText("6/6 items complete")).toBeVisible();
  const reportLink = page.getByRole("link", { name: "Completion report" });
  await expect(reportLink).toBeVisible();
  await expect(reportLink).toHaveAttribute(
    "href",
    `/repo/${OWNER}/${REPO}/reports/agency-request-healthy-ci`,
  );
});
