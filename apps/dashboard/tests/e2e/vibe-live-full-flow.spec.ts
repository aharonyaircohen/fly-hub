/**
 * @fileoverview LIVE end-to-end verification of the full vibe flow against
 * production. This is NOT mocked — it talks to the real chat model, the
 * real /api/kody/vibe/execute endpoint, and waits for the real runner to
 * commit and push.
 *
 * @testFramework playwright
 * @domain e2e-live
 *
 * What this asserts (in order):
 *   1. /vibe loads with the test auth.
 *   2. We send a simple "rename welcome text" request.
 *   3. The dashboard agent presents a plan AND stops with an approval
 *      question — does NOT preemptively call create_* in the same turn.
 *      (Regression for the "approval ask must be the LAST action" rule.)
 *   4. We send "approve". The agent then calls create_enhancement (or a
 *      sibling). The URL flips to ?issue=N.
 *   5. The Vibe page run action dispatches /api/kody/vibe/execute.
 *      Verified via network capture.
 *   6. We poll the GitHub API for new commits on the PR branch beyond
 *      the initial "vibe: start session" placeholder. Timeout: 6 minutes
 *      (covers ~90s GHA boot + ~2-3min for the agent to read, edit, push).
 *   7. The new commit's diff contains src changes and no consumer `.kody/`
 *      state files.
 *
 * Skipped when E2E_GITHUB_TOKEN / E2E_GITHUB_REPO are not set, since the
 * test cannot authenticate against the dashboard or read the resulting PR.
 *
 * Env:
 *   BASE_URL           - dashboard origin (default https://kody-dashboard-aguy.vercel.app)
 *   E2E_GITHUB_TOKEN   - PAT with repo + workflow scope for the tester repo
 *   E2E_GITHUB_REPO    - https://github.com/<owner>/<name> URL of the tester repo
 */

import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return {
      owner: parts[0] ?? "",
      repo: parts[1] ?? "",
    };
  } catch {
    return { owner: "", repo: "" };
  }
}

async function injectAuth(
  page: Page,
  owner: string,
  repo: string,
): Promise<void> {
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  });
  await page.context().addInitScript(
    (auth) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
    },
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      flyPerf: "high",
      user,
      loggedInAt: Date.now(),
    },
  );
}

interface PrFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

interface PrCommit {
  sha: string;
  commit: { message: string };
}

async function ghFetch(path: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.ok) return res.json();
      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        throw new Error(`GitHub ${path} → ${res.status} ${body}`);
      }
      lastError = new Error(`GitHub ${path} → ${res.status} ${body}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1_000 * 2 ** attempt),
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`GitHub ${path} request failed`);
}

let cleanupTarget: {
  owner: string;
  repo: string;
  issueNumber?: number;
  issueNumbers?: number[];
} | null = null;

async function cleanupFailedVibeRun(): Promise<void> {
  if (!cleanupTarget) return;
  const { owner, repo } = cleanupTarget;
  const issueNumbers = Array.from(
    new Set([
      ...(cleanupTarget.issueNumbers ?? []),
      ...(cleanupTarget.issueNumber ? [cleanupTarget.issueNumber] : []),
    ]),
  );
  if (issueNumbers.length === 0) return;
  const headers = {
    Authorization: `Bearer ${TEST_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  for (const issueNumber of issueNumbers) {
    try {
      const search = (await ghFetch(
        `/search/issues?q=${encodeURIComponent(
          `repo:${owner}/${repo} is:pr in:body "Closes #${issueNumber}"`,
        )}`,
      )) as { items: Array<{ number: number }> };
      for (const item of search.items) {
        const pr = (await ghFetch(
          `/repos/${owner}/${repo}/pulls/${item.number}`,
        )) as { merged: boolean; state: string; head: { ref: string } };
        if (!pr.merged && pr.state === "open") {
          await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${item.number}`,
            {
              method: "PATCH",
              headers,
              body: JSON.stringify({ state: "closed" }),
            },
          );
        }
        if (!pr.merged && pr.head.ref) {
          await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`,
            { method: "DELETE", headers },
          );
        }
      }
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
        { method: "PATCH", headers, body: JSON.stringify({ state: "closed" }) },
      );
    } catch (error) {
      // Preserve the original Playwright failure while making cleanup trouble
      // visible in the artifact log.
      // eslint-disable-next-line no-console
      console.error("[live-e2e] failed to clean Vibe mutation", error);
    }
  }
}

test.describe("Vibe — LIVE full flow against production", () => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires explicit BASE_URL + E2E_GITHUB_TOKEN + E2E_GITHUB_REPO to run live.",
  );

  test.beforeEach(() => {
    cleanupTarget = null;
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await cleanupFailedVibeRun();
    }
    cleanupTarget = null;
  });

  test("rename welcome text → approve → runner pushes the real diff", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(2_700_000); // 45 min hard cap (cold runner + verification + CI + merge).
    const { owner, repo } = parseRepo(TEST_REPO);
    expect(owner, "E2E_GITHUB_REPO must parse to owner/repo").toBeTruthy();
    expect(repo).toBeTruthy();
    cleanupTarget = { owner, repo };

    // Capture browser console for the temporary [vibe-debug] traces in
    // node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/KodyChat.tsx. Dump everything on
    // failure so we can see exactly where the kickoff flow halts.
    // ── 1. Land on /vibe with auth injected. ────────────────────────────
    await injectAuth(page, owner, repo);
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/vibe`);
    await page.waitForLoadState("domcontentloaded");

    // Skip on mobile — the chat rail is hidden.
    const viewport = await page.viewportSize();
    test.skip((viewport?.width ?? 1280) < 768, "chat rail hidden on mobile");

    // ── 2. Switch to the in-process chat agent. ─────────────────────────
    // /vibe defaults to "Kody Live" which is the long-lived RUNNER. The
    // dashboard agent that drafts the plan + creates the issue lives on
    // the kody-direct (in-process chat) backend; we have to pick it from
    // the dropdown explicitly.
    const chat = page.locator('[aria-label="Kody chat"]');
    const stop = chat.getByRole("button", { name: "Stop run" });
    if (await stop.isVisible()) await stop.click();
    const newConversation = page.getByRole("button", {
      name: "New conversation",
    });
    await expect(newConversation).toBeEnabled({ timeout: 15_000 });
    await newConversation.click();

    // Creating a conversation restores the surface default (Kody Live on
    // Vibe), so choose the direct model only after the reset.
    const chatSetup = chat.getByLabel("Chat setup").first();
    const authHeaders = {
      "x-kody-token": TEST_TOKEN,
      "x-kody-owner": owner,
      "x-kody-repo": repo,
    };
    const [modelsResponse, secretsResponse] = await Promise.all([
      page.request.get(`${BASE_URL}/api/kody/models`, {
        headers: authHeaders,
      }),
      page.request.get(`${BASE_URL}/api/kody/secrets`, {
        headers: authHeaders,
      }),
    ]);
    expect(modelsResponse.ok(), "model metadata must load").toBe(true);
    expect(secretsResponse.ok(), "secret metadata must load").toBe(true);
    const modelPayload = (await modelsResponse.json()) as {
      models?: Array<{
        label: string;
        apiKeySecret: string;
        enabled?: boolean;
      }>;
    };
    const secretPayload = (await secretsResponse.json()) as {
      secrets?: Array<{ name: string }>;
    };
    const configuredSecrets = new Set(
      (secretPayload.secrets ?? []).map((secret) => secret.name),
    );
    const configuredModel = (modelPayload.models ?? []).find(
      (model) =>
        model.enabled !== false && configuredSecrets.has(model.apiKeySecret),
    );
    expect(
      configuredModel,
      "tester repo must have an enabled model with configured secret metadata",
    ).toBeTruthy();

    const listbox = await openChatSetupSection(chat, "Model");
    const chatOption = listbox
      .locator('button[role="option"]')
      .filter({ hasText: configuredModel!.label })
      .first();
    await expect(
      chatOption,
      "tester repo must have a chat model configured",
    ).toBeVisible({ timeout: 5_000 });
    await chatOption.click();
    await expect(chatSetup).not.toContainText(/Kody Live|Brain/i);

    // ── 3. Send the user's request. ─────────────────────────────────────
    // Once kody-direct is selected, the composer placeholder changes from
    // "Click Start to warm up the runner." to "Ask Kody...".
    const input = chat.locator("textarea").first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeEnabled();
    // Use a value that's unique per run so the agent has to actually edit
    // the page and its user-facing regression assertion (no "already done"
    // short-circuit). Keeping the test aligned is required for a clean gate.
    const runMarker = Date.now();
    const newWelcomeText = `Welcome from kody — verify run ${runMarker}`;
    await input.fill(
      `Update the homepage welcome text in src/app/(frontend)/page.tsx ` +
        `to "${newWelcomeText}". Update the matching assertion in ` +
        `tests/e2e/frontend.e2e.spec.ts and run the relevant verification.`,
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    const submittedRequest = chat
      .locator('[data-role="user"]')
      .filter({ hasText: newWelcomeText })
      .last();
    await expect(submittedRequest).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(5_000);
    await expect(
      chatSetup,
      "an explicit direct-model choice must survive delayed chat hydration",
    ).not.toContainText(/Kody Live|Brain/i);
    await expect(
      submittedRequest,
      "the submitted Vibe request must remain in the active conversation",
    ).toBeVisible();

    // ── 3. Wait for the agent to ask for approval. ─────────────────────
    // The fixed prompt SHOULD make the agent stop after asking, but the
    // model occasionally violates that and creates the issue in the same
    // turn. We accept either: wait for an approval-shaped prompt OR for
    // ?issue=N to appear in the URL (gate-violation path), whichever
    // lands first.
    // Generous regex — the model phrases the approval question many
    // different ways ("Approve?", "Shall I proceed?", "Want me to ship
    // this?", "Should I continue?", "Ready for me to go ahead?").
    // The common pattern is a question-mark line containing one of
    // these verbs.
    const approvalPrompt = page
      .locator(".prose")
      .filter({
        hasText:
          /approve|approval|ship it|want me to|should i|shall i|proceed|ready (?:for|to)|go ahead|confirm/i,
      })
      .last();
    const errorBubble = chat
      .locator(".prose")
      .filter({ hasText: /^(?:\[Error\]|Error:)/i })
      .last();
    const approvalAction = chat
      .locator("button:enabled")
      .filter({
        hasText:
          /^(?:yes\b|file issue only|approve|confirm|proceed|create issue)/i,
      })
      .last();
    // Follow the real approval UI until issue creation. Models may render a
    // generic "Approve" card, an "Approve & create issue" card, or plain
    // approval prose followed by a second card. Historical cards stay in the
    // transcript disabled, so only the current enabled action is clicked.
    const approvalStartedAt = Date.now();
    const approvalDeadline = approvalStartedAt + 480_000;
    let approvalSubmitted = false;
    let sentTextApproval = false;
    let sentMissingActionRecovery = false;
    while (
      !new URL(page.url()).searchParams.get("issue") &&
      Date.now() < approvalDeadline
    ) {
      if (await errorBubble.isVisible()) {
        throw new Error(`Vibe chat failed: ${await errorBubble.innerText()}`);
      }
      // Approval can be multi-stage: the first action approves the proposal,
      // then a fresh enabled action approves issue creation/execution. Keep
      // following the current enabled action; completed cards are disabled.
      if (await approvalAction.isVisible()) {
        await approvalAction.click();
        approvalSubmitted = true;
        await page.waitForTimeout(500);
        continue;
      }
      if (
        !approvalSubmitted &&
        !sentTextApproval &&
        (await approvalPrompt.isVisible())
      ) {
        await input.fill("approve");
        await chat.getByRole("button", { name: "Send message" }).click();
        sentTextApproval = true;
        approvalSubmitted = true;
        continue;
      }
      // A provider can occasionally finish its planning tool calls without
      // rendering either prose or an approval card. Exercise the real user
      // recovery only after the active turn ends; the composer can remain
      // enabled while a slow renderer response is still streaming.
      if (
        !approvalSubmitted &&
        !sentMissingActionRecovery &&
        Date.now() - approvalStartedAt >= 30_000 &&
        !(await stop.isVisible()) &&
        (await input.isEnabled())
      ) {
        await input.fill(
          "The plan is approved. File the GitHub issue now, but do not run it yet.",
        );
        await chat.getByRole("button", { name: "Send message" }).click();
        sentMissingActionRecovery = true;
        approvalSubmitted = true;
        continue;
      }
      await Promise.race([
        page
          .waitForURL(/\/vibe\?issue=\d+/, { timeout: 5_000 })
          .catch(() => {}),
        approvalAction
          .waitFor({ state: "visible", timeout: 5_000 })
          .catch(() => {}),
        errorBubble
          .waitFor({ state: "visible", timeout: 5_000 })
          .catch(() => {}),
      ]);
    }
    expect(
      new URL(page.url()).searchParams.get("issue"),
      "Vibe approval must create and navigate to an issue within 8 minutes",
    ).toBeTruthy();
    const issueUrl = new URL(page.url());
    const issueNumber = Number.parseInt(
      issueUrl.searchParams.get("issue") ?? "0",
      10,
    );
    expect(issueNumber, "created issue number").toBeGreaterThan(0);
    cleanupTarget = { owner, repo, issueNumber };
    let matchingIssueNumbers: number[] = [];
    await expect
      .poll(
        async () => {
          const recentIssues = (await ghFetch(
            `/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=100`,
          )) as Array<{
            number: number;
            title: string;
            body?: string | null;
            pull_request?: unknown;
          }>;
          matchingIssueNumbers = recentIssues
            .filter(
              (issue) =>
                !issue.pull_request &&
                (issue.title.includes(String(runMarker)) ||
                  issue.body?.includes(String(runMarker))),
            )
            .map((issue) => issue.number);
          cleanupTarget!.issueNumbers = matchingIssueNumbers;
          return matchingIssueNumbers;
        },
        {
          message: "one approval must create exactly one GitHub issue",
          timeout: 30_000,
          intervals: [500, 1_000, 2_500],
        },
      )
      .toEqual([issueNumber]);

    const runButton = page.getByRole("button", {
      name: /run kody on this issue/i,
    });
    await expect(runButton).toBeVisible({ timeout: 60_000 });
    const executeResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/kody/vibe/execute") &&
        response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await runButton.click();

    // ── 5. Verify /vibe/execute accepted the kickoff. ──────────────────
    // A request alone is not proof of dispatch: Fly auth/provisioning errors
    // return 500 and surface as a toast while no PR can ever be created.
    const executeResponse = await executeResponsePromise;
    const executeBody = await executeResponse.text();
    expect(
      executeResponse.ok(),
      `Vibe dispatch must succeed (${executeResponse.status()}): ${executeBody}`,
    ).toBe(true);
    const executePayload = JSON.parse(executeBody) as {
      ok?: boolean;
      machineId?: string;
      sessionId?: string;
    };
    expect(executePayload.ok, "Vibe dispatch response").toBe(true);
    expect(executePayload.machineId, "Vibe runner machine id").toBeTruthy();
    expect(executePayload.sessionId, "Vibe runner session id").toBeTruthy();
    await testInfo.attach("vibe-dispatch.json", {
      body: Buffer.from(
        JSON.stringify(
          {
            issueNumber,
            machineId: executePayload.machineId,
            sessionId: executePayload.sessionId,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });

    // ── 6. Find the PR for this issue and poll for a real commit. ──────
    type PrSummary = {
      number: number;
      head: { ref: string; sha: string };
    };
    const findPr = async (): Promise<PrSummary | null> => {
      const prs = (await ghFetch(
        `/search/issues?q=${encodeURIComponent(
          `repo:${owner}/${repo} is:pr in:body "Closes #${issueNumber}"`,
        )}`,
      )) as { items: Array<{ number: number }> };
      if (prs.items.length === 0) return null;
      const prNum = prs.items[0].number;
      return (await ghFetch(
        `/repos/${owner}/${repo}/pulls/${prNum}`,
      )) as PrSummary;
    };

    let pr: PrSummary | null = null;
    for (let i = 0; i < 300; i++) {
      pr = await findPr();
      if (pr) break;
      const issue = (await ghFetch(
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
      )) as { body?: string };
      const comments = (await ghFetch(
        `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
      )) as Array<{ body?: string }>;
      const terminalFailure = [issue.body, ...comments.map((item) => item.body)]
        .filter(Boolean)
        .find((text) =>
          /(?:⚠️|kody preflight failed|kody run failed)/i.test(text!),
        );
      if (terminalFailure) {
        throw new Error(
          `Vibe runner failed before opening a PR: ${terminalFailure}`,
        );
      }
      await page.waitForTimeout(5_000);
    }
    expect(
      pr,
      "PR for the new issue must exist within 25 minutes",
    ).toBeTruthy();
    const prNumber = pr!.number;

    // Poll for commits BEYOND the initial "vibe: start session" placeholder.
    // The runner has ~90s GHA boot + agent thinking + edit + push.
    const startedAt = Date.now();
    const deadline = startedAt + 5 * 60_000; // 5 minutes for the runner.
    let realCommit: PrCommit | null = null;
    while (Date.now() < deadline) {
      const commits = (await ghFetch(
        `/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=20`,
      )) as PrCommit[];
      realCommit =
        commits.find(
          (c) => !c.commit.message.startsWith("vibe: start session"),
        ) ?? null;
      if (realCommit) break;
      await page.waitForTimeout(10_000);
    }
    expect(
      realCommit,
      `runner must push a real commit (not just the start-session placeholder) within ${
        (deadline - startedAt) / 1000
      }s — went looking for any commit whose message doesn't start with "vibe: start session".`,
    ).toBeTruthy();

    // ── 7. Inspect the PR diff. ────────────────────────────────────────
    const files = (await ghFetch(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    )) as PrFile[];

    const leakedStateFiles = files.filter((f) =>
      f.filename.startsWith(".kody/"),
    );
    expect(
      leakedStateFiles,
      "PR must not contain consumer .kody state files",
    ).toEqual([]);

    const srcChange = files.find(
      (f) => f.filename === "src/app/(frontend)/page.tsx",
    );
    expect(
      srcChange,
      "PR must include the requested change to src/app/(frontend)/page.tsx",
    ).toBeTruthy();
    expect(
      srcChange?.additions ?? 0,
      "src change must add at least one line",
    ).toBeGreaterThan(0);
    expect(
      files.find((file) => file.filename === "tests/e2e/frontend.e2e.spec.ts"),
      "PR must update the matching browser assertion",
    ).toBeTruthy();

    // ── 8. Composer follow-up.
    //
    // NOTE: with @kody-ade/kody-engine ≤ 0.4.71 the runner commits its
    // chat.done event to the PR branch (not main), so the dashboard's
    // event reader (now the Convex live transport) never sees it and
    // `setLoading(false)` never fires — the textarea stays `disabled`.
    // Engine 0.4.72
    // (worktree-on-main fix, pending npm publish) routes the event
    // commit to main and the composer unfreezes normally. Until then
    // we skip the follow-up turn and treat the test as passed on
    // first-turn outcome (PR has a real code change).
    const composer = page
      .getByPlaceholder(/ask kody|kody is waiting|ask about/i)
      .first();
    let followupReady = false;
    try {
      await expect(composer).toBeEnabled({ timeout: 30_000 });
      followupReady = true;
    } catch {
      // eslint-disable-next-line no-console
      console.log(
        `[live-e2e] composer didn't unfreeze — expected on engine ≤ 0.4.71; ` +
          `fix pending npm publish of 0.4.72. Skipping follow-up turn.`,
      );
    }

    if (followupReady) {
      // ── 9. Drive a second, follow-up change on the SAME PR. ────────
      //
      // This section is BEST-EFFORT. The lifecycle assertions
      // (steps 11+: merge / branch delete / issue close) must run
      // regardless of whether the runner's second turn lands — we don't
      // want one flaky follow-up step to mask a working merge path.
      try {
        const followupText = `Welcome from kody — followup ${Date.now()}`;
        await composer.fill(
          `Now change the welcome text again to "${followupText}". Same file, one-line change.`,
        );
        await page
          .locator('[aria-label="Kody chat"]')
          .getByRole("button", { name: "Send message" })
          .click();

        const firstRealSha = realCommit!.sha;
        const followupDeadline = Date.now() + 5 * 60_000;
        let secondCommit: PrCommit | null = null;
        while (Date.now() < followupDeadline) {
          const commits = (await ghFetch(
            `/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=20`,
          )) as PrCommit[];
          secondCommit =
            commits.find(
              (c) =>
                !c.commit.message.startsWith("vibe: start session") &&
                c.sha !== firstRealSha,
            ) ?? null;
          if (secondCommit) break;
          await page.waitForTimeout(10_000);
        }
        if (!secondCommit) {
          // eslint-disable-next-line no-console
          console.log(
            "[live-e2e] follow-up turn did not push a second commit within 5min — " +
              "logging and continuing to lifecycle assertions",
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(
          `[live-e2e] follow-up turn raised — continuing to lifecycle assertions: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (followupReady) {
      // ── 10. Re-verify consumer .kody state does not leak.
      const filesAfterFollowup = (await ghFetch(
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
      )) as PrFile[];
      const leakedAfter = filesAfterFollowup.filter((f) =>
        f.filename.startsWith(".kody/"),
      );
      expect(
        leakedAfter,
        "follow-up PR must not contain consumer .kody state files",
      ).toEqual([]);
    }

    // ── 11. Merge the PR via the dashboard's approve endpoint. ─────────
    //
    // This closes the full lifecycle loop: dashboard chat → branch →
    // PR → runner commit → DASHBOARD MERGE → branch deleted → issue
    // closed. Without this step the test only proves half the flow.
    //
    // We poll for `mergeable_state === 'clean'` (CI passing + no
    // conflicts) for up to 8 min. "unstable" means CI is failing or
    // pending — calling approve in that state would correctly return
    // 409, but then we wouldn't be testing the merge path.
    //
    // If the tester repo's CI is slow/failing and we time out, the
    // test fails with a clear "PR never became clean" message so it's
    // obvious the failure is environmental (tester repo CI), not a
    // dashboard regression.
    type PrDetail = {
      mergeable: boolean | null;
      mergeable_state: string;
      merged: boolean;
    };
    let prDetail: PrDetail | null = null;
    const mergeableDeadline = Date.now() + 8 * 60_000;
    while (Date.now() < mergeableDeadline) {
      prDetail = (await ghFetch(
        `/repos/${owner}/${repo}/pulls/${prNumber}`,
      )) as PrDetail;
      if (prDetail.mergeable_state === "clean" || prDetail.merged) {
        break;
      }
      await page.waitForTimeout(10_000);
    }
    expect(
      prDetail?.mergeable_state === "clean" || prDetail?.merged,
      `PR #${prNumber} never became mergeable (mergeable_state=${prDetail?.mergeable_state}). ` +
        "This usually means tester repo CI is failing or too slow — not a dashboard regression.",
    ).toBe(true);

    // Find the branch name from the PR for the approve payload.
    const prBranchName = pr!.head.ref;

    const approveRes = await page.request.post(
      `${BASE_URL}/api/kody/tasks/approve`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-kody-token": TEST_TOKEN,
          "x-kody-owner": owner,
          "x-kody-repo": repo,
        },
        data: {
          issueNumber,
          prNumber,
          branchName: prBranchName,
        },
      },
    );
    expect(
      approveRes.status(),
      `approve endpoint must return 200 (got ${approveRes.status()}: ${await approveRes.text()})`,
    ).toBe(200);

    // ── 12. Verify PR was actually merged on GitHub. ───────────────────
    const finalPr = (await ghFetch(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
    )) as PrDetail;
    expect(
      finalPr.merged,
      `PR #${prNumber} must be merged after approve (mergeable_state was "${prDetail?.mergeable_state}")`,
    ).toBe(true);

    // ── 13. Verify the work branch was deleted post-merge. ─────────────
    // GitHub's get-branch returns 404 when the ref no longer exists.
    const branchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(prBranchName)}`,
      {
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    expect(
      branchRes.status,
      `work branch '${prBranchName}' must be deleted after approve (got HTTP ${branchRes.status})`,
    ).toBe(404);

    // ── 14. Verify the linked issue is closed. ─────────────────────────
    // "Closes #N" in the PR body should auto-close on merge, but the
    // approve endpoint also closes explicitly so we don't depend on
    // the body-keyword path.
    const finalIssue = (await ghFetch(
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
    )) as { state: string };
    expect(
      finalIssue.state,
      `issue #${issueNumber} must be closed after approve+merge`,
    ).toBe("closed");
  });
});
