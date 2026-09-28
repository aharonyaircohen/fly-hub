import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("refreshing real Loops preserves task monitoring and its deadline", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires live repository credentials",
  );
  const { owner, repo } = parseRepo(TEST_REPO);
  const headers = {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  const marker = `audit-loop-${Date.now()}`;

  await page.context().addInitScript(
    ({ auth }) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
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

  const client = createBackendClient();
  const tenantId = `${owner}/${repo}`;
  const kind = `todo:${marker}`;
  const loopId = `agency-request-${marker}`;
  const now = new Date().toISOString();
  async function registration() {
    const deployment = process.env.CONVEX_DEPLOYMENT?.split(":").pop();
    if (
      !deployment ||
      !new URL(process.env.CONVEX_URL!).hostname.startsWith(`${deployment}.`)
    ) {
      throw new Error(
        "Schedule inspection requires CONVEX_DEPLOYMENT to match CONVEX_URL",
      );
    }
    // Scheduler tables are intentionally excluded from backup/export. Inspect
    // the confirmed deployment through the existing administrative CLI instead.
    const output = execFileSync(
      "rtk",
      [
        "proxy",
        "pnpm",
        "exec",
        "convex",
        "data",
        "loopWakeRegistrations",
        "--format",
        "json",
        "--limit",
        "10000",
      ],
      {
        cwd: resolve(process.cwd(), "../../packages/kody-backend"),
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const rows = JSON.parse(output) as Array<{
      tenantId: string;
      loopId: string;
      nextDueAt?: string;
    }>;
    expect(
      rows.length,
      "Schedule inspection must not truncate records",
    ).toBeLessThan(10000);
    return rows.find(
      (row) => row.tenantId === tenantId && row.loopId === loopId,
    );
  }
  try {
    await client.mutation(api.repoDocs.save, {
      tenantId,
      kind,
      updatedAt: now,
      doc: {
        version: 1,
        title: marker,
        description: "",
        createdAt: now,
        items: [],
        agencyRequest: {
          phase: "monitoring",
          source: { kind: "guided-flow", instanceId: marker, effectId: marker },
          requirement: { outcome: "Verify schedule persistence" },
          questions: [],
          plan: [],
          evidence: [],
          blockers: [],
          execution: { workflowId: "audit-no-execution", input: {} },
          related: [{ kind: "loop", id: loopId }],
        },
      },
    });
    const before = await registration();
    expect(before).toMatchObject({
      loopId,
      trigger: { type: "schedule", every: "15m" },
    });
    expect(before && "nextDueAt" in before && before.nextDueAt).toBeTruthy();
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/agent-loops`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Loops", exact: true }),
    ).toBeVisible();
    const refresh = page.waitForResponse(
      (response) =>
        response.url().includes("/api/kody/loops") &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Refresh loops" }).click();
    expect((await refresh).status()).toBe(200);
    expect(await registration()).toEqual(before);
    await client.mutation(api.loopWakes.syncRegistration, {
      tenantId,
      loopId,
      enabled: true,
      trigger: { type: "schedule", every: "15m" },
      updatedAt: new Date().toISOString(),
    });
    const refreshed = await registration();
    expect(
      refreshed && "nextDueAt" in refreshed && refreshed.nextDueAt,
    ).toEqual(before && "nextDueAt" in before && before.nextDueAt);
  } finally {
    await client.mutation(api.repoDocs.remove, { tenantId, kind });
    expect(await registration()).toBeUndefined();
  }
});
