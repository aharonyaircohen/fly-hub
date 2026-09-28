import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";
import type { APIResponse } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "";
const EXECUTION_BASE_URL =
  process.env.KODY_TRIGGER_EXECUTION_BASE_URL ?? BASE_URL;
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
const TEST_KODY_WORKFLOW_ID = "trigger-e2e";
const TEST_KODY_WORKFLOW_NAME = "Trigger E2E";
const TEST_KODY_CAPABILITY =
  process.env.E2E_KODY_TRIGGER_CAPABILITY ?? "ci-health-check";

interface LiveWorkflowDefinition {
  id: string;
  workflow: { name: string; runWithoutApproval?: boolean };
  source?: "local" | "store";
  runnable?: boolean;
  automation:
    { eligible: true } | { eligible: false; reason: "approval-required" };
}

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

function apiHeaders(owner: string, repo: string) {
  return {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
}

async function installAuth(page: Page, owner: string, repo: string) {
  const user = await resolveLiveGitHubUser(
    page,
    BASE_URL,
    apiHeaders(owner, repo),
  );
  await page.context().addInitScript(
    ({ auth }) => {
      if (!localStorage.getItem("kody_auth")) {
        localStorage.setItem("kody_auth", JSON.stringify(auth));
      }
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user,
        loggedInAt: Date.now(),
        repos: [
          {
            repoUrl: TEST_REPO,
            owner,
            repo,
            token: TEST_TOKEN,
            user,
            addedAt: Date.now(),
            isLogin: true,
          },
        ],
        currentRepoIndex: 0,
      },
    },
  );
}

async function expectOk(response: APIResponse) {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function ensureRepositoryConnection(
  page: Page,
  owner: string,
  repo: string,
  headers: ReturnType<typeof apiHeaders>,
) {
  const connection = await page.request.post(`${BASE_URL}/api/kody/repos/add`, {
    data: { owner, repo, token: TEST_TOKEN },
  });
  const connectionBody = await expectOk(connection);
  expect(connectionBody.backgroundAccess).toMatchObject({ ok: true });
  expect(["github-app", "encrypted-pat"]).toContain(
    (connectionBody.backgroundAccess as { source?: string }).source,
  );

  if (EXECUTION_BASE_URL !== BASE_URL) {
    const registration = await page.request.post(
      `${EXECUTION_BASE_URL}/api/webhooks/register`,
      { headers, data: { owner, repo } },
    );
    await expectOk(registration);
  }
}

async function ensureTriggerWorkflow(
  page: Page,
  headers: ReturnType<typeof apiHeaders>,
): Promise<LiveWorkflowDefinition> {
  const list = async () => {
    const response = await page.request.get(
      `${BASE_URL}/api/kody/company/workflows`,
      { headers },
    );
    const body = await expectOk(response);
    return (body.workflows ?? []) as LiveWorkflowDefinition[];
  };

  let workflow = (await list()).find(
    (candidate) => candidate.id === TEST_KODY_WORKFLOW_ID,
  );
  if (!workflow) {
    const created = await page.request.post(
      `${BASE_URL}/api/kody/company/workflows`,
      {
        headers,
        data: {
          id: TEST_KODY_WORKFLOW_ID,
          name: TEST_KODY_WORKFLOW_NAME,
          agent: "kody",
          capabilities: [TEST_KODY_CAPABILITY],
          runWithoutApproval: true,
        },
      },
    );
    await expectOk(created);
    workflow = (await list()).find(
      (candidate) => candidate.id === TEST_KODY_WORKFLOW_ID,
    );
  } else if (!workflow.automation.eligible && workflow.source === "local") {
    const updated = await page.request.patch(
      `${BASE_URL}/api/kody/company/workflows/${TEST_KODY_WORKFLOW_ID}`,
      { headers, data: { runWithoutApproval: true } },
    );
    await expectOk(updated);
    workflow = (await list()).find(
      (candidate) => candidate.id === TEST_KODY_WORKFLOW_ID,
    );
  }

  expect(workflow).toMatchObject({
    id: TEST_KODY_WORKFLOW_ID,
    workflow: { name: TEST_KODY_WORKFLOW_NAME },
    runnable: true,
    automation: { eligible: true },
  });
  return workflow!;
}

test("creates, persists, and executes a GitHub workflow trigger", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires live repository credentials",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  const headers = apiHeaders(owner, repo);
  const githubHeaders = {
    authorization: `Bearer ${TEST_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const marker = `live-trigger-${Date.now()}`;
  await ensureRepositoryConnection(page, owner, repo, headers);
  const kodyWorkflow = await ensureTriggerWorkflow(page, headers);
  const githubWorkflowsResponse = await page.request.get(
    `${BASE_URL}/api/kody/github/workflows`,
    { headers },
  );
  expect(githubWorkflowsResponse.ok()).toBe(true);
  const githubWorkflows = (await githubWorkflowsResponse.json())
    .workflows as Array<{
    id: number;
    name: string;
  }>;
  const githubWorkflow = githubWorkflows.find(
    (workflow) => workflow.name === "Test CI",
  );
  expect(githubWorkflow).toBeTruthy();

  await installAuth(page, owner, repo);
  // The shared shell requests this optional widget on every repo page. It is
  // not part of the trigger journey and is not installed in the test repo.
  await page.route("**/api/kody/widgets/question-select**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export default function mount() {}",
    }),
  );

  async function removeTrigger() {
    for (const baseUrl of new Set([BASE_URL, EXECUTION_BASE_URL])) {
      const response = await page.request.delete(
        `${baseUrl}/api/kody/triggers/${marker}`,
        { headers },
      );
      expect([204, 404]).toContain(response.status());
    }
  }

  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/triggers`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Triggers", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "New trigger", exact: true })
      .click();

    await page.getByRole("combobox", { name: "Trigger" }).click();
    await page
      .getByRole("option", { name: "GitHub workflow finishes" })
      .click();
    await page
      .getByRole("combobox", { name: "GitHub workflow", exact: true })
      .click();
    await page
      .getByRole("option", { name: githubWorkflow!.name, exact: true })
      .click();

    await page.getByRole("combobox", { name: "Action" }).click();
    await page
      .getByRole("option", { name: "Start a Kody workflow", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Kody workflow to start" })
      .click();
    await page
      .getByRole("option", { name: new RegExp(kodyWorkflow!.workflow.name) })
      .click();
    await expect(
      page.getByText("More filters and input mapping (optional)"),
    ).toHaveCount(0);
    await page.getByLabel("Name").fill(marker);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      page.getByText("Trigger saved", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${BASE_URL}/api/kody/triggers`,
          { headers },
        );
        const body = (await response.json()) as {
          triggers?: Array<{
            id: string;
            event: string;
            action: { type: string; workflowId?: string };
            conditions: Array<{ path: string; value?: unknown }>;
          }>;
        };
        return body.triggers?.find((trigger) => trigger.id === marker) ?? null;
      })
      .toMatchObject({
        id: marker,
        event: "github.workflow_run.completed",
        action: { type: "start-workflow", workflowId: kodyWorkflow!.id },
        conditions: [{ path: "workflowId", value: githubWorkflow!.id }],
      });

    if (EXECUTION_BASE_URL !== BASE_URL) {
      const executionTriggerResponse = await page.request.post(
        `${EXECUTION_BASE_URL}/api/kody/triggers`,
        {
          headers,
          data: {
            trigger: {
              id: marker,
              name: marker,
              enabled: true,
              event: "github.workflow_run.completed",
              conditions: [
                {
                  path: "workflowId",
                  op: "equals",
                  value: githubWorkflow!.id,
                },
              ],
              action: {
                type: "start-workflow",
                workflowId: kodyWorkflow!.id,
                inputMap: {},
              },
            },
          },
        },
      );
      expect(executionTriggerResponse.ok()).toBe(true);
    }

    const dispatchedAfter = Date.now() - 5_000;
    const hooksResponse = await page.request.get(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      { headers: githubHeaders },
    );
    expect(hooksResponse.ok()).toBe(true);
    const hooks = (await hooksResponse.json()) as Array<{
      id: number;
      config?: { url?: string };
    }>;
    const dashboardHook = hooks.find(
      (hook) =>
        hook.config?.url &&
        new URL(hook.config.url).pathname === "/api/webhooks/github",
    );
    expect(dashboardHook).toBeTruthy();

    let completedSourceDeliveryId: string | null = null;
    let deliveriesUrl = `https://api.github.com/repos/${owner}/${repo}/hooks/${dashboardHook!.id}/deliveries?per_page=100`;
    for (let deliveryPage = 1; deliveryPage <= 10; deliveryPage += 1) {
      const deliveriesResponse = await page.request.get(deliveriesUrl, {
        headers: githubHeaders,
      });
      const deliveriesText = await deliveriesResponse.text();
      expect(
        deliveriesResponse.ok(),
        `GitHub deliveries page ${deliveryPage} failed (${deliveriesResponse.status()}): ${deliveriesText}`,
      ).toBe(true);
      const deliveries = JSON.parse(
        deliveriesText.replace(/"id":\s*(\d{16,})/g, '"id":"$1"'),
      ) as Array<{ id: string; event: string; action?: string }>;
      for (const delivery of deliveries.filter(
        (candidate) =>
          candidate.event === "workflow_run" &&
          candidate.action === "completed",
      )) {
        const detailResponse = await page.request.get(
          `https://api.github.com/repos/${owner}/${repo}/hooks/${dashboardHook!.id}/deliveries/${delivery.id}`,
          { headers: githubHeaders },
        );
        if (!detailResponse.ok()) continue;
        const detail = (await detailResponse.json()) as {
          request?: { payload?: { workflow_run?: { workflow_id?: number } } };
        };
        if (
          detail.request?.payload?.workflow_run?.workflow_id ===
          githubWorkflow!.id
        ) {
          completedSourceDeliveryId = delivery.id;
          break;
        }
      }
      if (completedSourceDeliveryId) break;
      const nextLink = deliveriesResponse
        .headers()
        ["link"]?.match(/<([^>]+)>;\s*rel="next"/i)?.[1];
      if (!nextLink) break;
      deliveriesUrl = nextLink;
    }
    expect(completedSourceDeliveryId).toBeTruthy();
    const redeliveryResponse = await page.request.post(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${dashboardHook!.id}/deliveries/${completedSourceDeliveryId}/attempts`,
      { headers: githubHeaders },
    );
    expect(redeliveryResponse.status(), await redeliveryResponse.text()).toBe(
      202,
    );

    type ObservedWorkflowEvent = {
      triggerId: string;
      workflowId: string;
      eventName: string;
      status: string;
      error?: string;
    };
    const readWorkflowEvent =
      async (): Promise<ObservedWorkflowEvent | null> => {
        const response = await page.request.get(
          `${EXECUTION_BASE_URL}/api/kody/workflow-events?limit=100`,
          { headers },
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as {
          events?: ObservedWorkflowEvent[];
        };
        return body.events?.find((event) => event.triggerId === marker) ?? null;
      };
    await expect
      .poll(
        async () => {
          const event = await readWorkflowEvent();
          return event?.status ?? null;
        },
        { timeout: 150_000, intervals: [3_000, 5_000, 10_000] },
      )
      .toMatch(/^(dispatched|failed)$/);
    const observedWorkflowEvent = await readWorkflowEvent();
    expect(
      observedWorkflowEvent,
      observedWorkflowEvent?.error ?? "Triggered workflow execution failed",
    ).toMatchObject({
      triggerId: marker,
      workflowId: kodyWorkflow!.id,
      eventName: "github.workflow_run.completed",
      status: "dispatched",
    });

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `https://api.github.com/repos/${owner}/${repo}/actions/workflows/kody.yml/runs?event=workflow_dispatch&per_page=20`,
            { headers: githubHeaders },
          );
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            workflow_runs?: Array<{
              id: number;
              created_at: string;
              html_url: string;
            }>;
          };
          return (
            body.workflow_runs?.find(
              (run) => Date.parse(run.created_at) >= dispatchedAfter,
            ) ?? null
          );
        },
        { timeout: 60_000, intervals: [2_000, 5_000] },
      )
      .toMatchObject({ id: expect.any(Number), html_url: expect.any(String) });
  } finally {
    await removeTrigger();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${BASE_URL}/api/kody/triggers`,
          { headers },
        );
        const body = (await response.json()) as {
          triggers?: Array<{ id: string }>;
        };
        return body.triggers?.some((trigger) => trigger.id === marker) ?? false;
      })
      .toBe(false);
  }
});

test("replaces the active repository PAT after real GitHub validation", async ({
  page,
}) => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires live repository credentials",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  await installAuth(page, owner, repo);
  await page.route("**/api/kody/widgets/question-select**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export default function mount() {}",
    }),
  );

  await page.goto(`${BASE_URL}/repo/${owner}/${repo}/triggers`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTitle("Switch repository").click();
  await page
    .getByRole("button", { name: `Update PAT for ${owner}/${repo}` })
    .click();
  const dialog = page.getByRole("dialog", { name: "Update PAT" });
  await dialog.getByLabel("New personal access token").fill(TEST_TOKEN);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    dialog.getByRole("button", { name: "Save" }).click(),
  ]);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kody_auth") ?? "null"),
  );
  expect(stored).toMatchObject({
    owner,
    repo,
    repos: [expect.objectContaining({ owner, repo })],
  });
  expect(stored.token === TEST_TOKEN).toBe(true);
  expect(stored.repos[0]?.token === TEST_TOKEN).toBe(true);
});
