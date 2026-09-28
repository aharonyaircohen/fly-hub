import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TARGET_REPOSITORY = process.env.E2E_GITHUB_REPO ?? "";
const SOURCE = { owner: "aharonyaircohen", repo: "kody-chat" };

function repositoryParts(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

function headers(owner: string, repo: string) {
  return {
    "x-kody-token": TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
}

function copyShape(value: unknown) {
  const capability = (value as { capability?: Record<string, unknown> })
    .capability;
  return capability
    ? {
        instructions: capability.instructions,
        contract: capability.contract,
        skills: capability.skills,
        capabilityTools: capability.capabilityTools,
      }
    : null;
}

test("real Kody copies and verifies a capability across connected repositories", async ({
  page,
}) => {
  test.setTimeout(600_000);
  test.skip(
    !BASE_URL || !TOKEN || !TARGET_REPOSITORY,
    "Requires the live target, QA account, and tester repository",
  );

  const target = repositoryParts(TARGET_REPOSITORY);
  expect(process.env.RUN_REAL_E2E).toBe("1");
  expect(target).not.toEqual(SOURCE);

  const actor = await resolveLiveGitHubUser(
    page,
    BASE_URL,
    headers(target.owner, target.repo),
  );
  const accountUrl = `${BASE_URL}/api/kody/account/repositories`;
  const originalResponse = await page.request.get(accountUrl);
  expect(originalResponse.status()).toBe(200);
  const original = (await originalResponse.json()) as {
    auth?: Record<string, unknown> & {
      repos?: Array<
        Record<string, unknown> & { owner?: string; repo?: string }
      >;
    };
  };
  const originalAuth = original.auth ?? null;
  const now = Date.now();
  const configuredRepositories = [
    ...(originalAuth?.repos ?? []).filter(
      (entry) =>
        !(
          (entry.owner === SOURCE.owner && entry.repo === SOURCE.repo) ||
          (entry.owner === target.owner && entry.repo === target.repo)
        ),
    ),
    {
      repoUrl: `https://github.com/${SOURCE.owner}/${SOURCE.repo}`,
      ...SOURCE,
      token: TOKEN,
      addedAt: now,
      isLogin: false,
      user: actor,
    },
    {
      repoUrl: TARGET_REPOSITORY,
      ...target,
      token: TOKEN,
      addedAt: now,
      isLogin: false,
      user: actor,
    },
  ];
  const activeAuth = {
    ...(originalAuth ?? {}),
    repoUrl: TARGET_REPOSITORY,
    ...target,
    token: TOKEN,
    user: actor,
    loggedInAt: now,
    repos: configuredRepositories,
    currentRepoIndex: configuredRepositories.length - 1,
  };

  let copiedSlug: string | null = null;
  try {
    expect(
      (
        await page.request.put(accountUrl, {
          data: { auth: activeAuth },
        })
      ).status(),
    ).toBe(200);

    const sourceListResponse = await page.request.get(
      `${BASE_URL}/api/kody/capabilities`,
      { headers: headers(SOURCE.owner, SOURCE.repo) },
    );
    expect(sourceListResponse.status()).toBe(200);
    const sourceList = (await sourceListResponse.json()) as {
      capabilities?: Array<{ slug?: string }>;
    };
    for (const candidate of sourceList.capabilities ?? []) {
      if (!candidate.slug) continue;
      const targetResponse = await page.request.get(
        `${BASE_URL}/api/kody/capabilities/${candidate.slug}`,
        { headers: headers(target.owner, target.repo) },
      );
      if (targetResponse.status() === 404) {
        copiedSlug = candidate.slug;
        break;
      }
    }
    expect(
      copiedSlug,
      "a source capability absent from the QA target",
    ).toBeTruthy();

    const sourceDetailResponse = await page.request.get(
      `${BASE_URL}/api/kody/capabilities/${copiedSlug}`,
      { headers: headers(SOURCE.owner, SOURCE.repo) },
    );
    expect(sourceDetailResponse.status()).toBe(200);
    const sourceDetail = await sourceDetailResponse.json();

    await page.goto(`${BASE_URL}/repo/${target.owner}/${target.repo}/chat`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]');
    await expect(
      chat.getByRole("button", { name: "New conversation" }),
    ).toBeEnabled({ timeout: 30_000 });
    await chat.getByRole("button", { name: "New conversation" }).click();
    const setup = chat.getByLabel("Chat setup").first();
    await setup.click();
    await openChatSetupSection(chat, "Model");
    const requestedModelLabel = process.env.E2E_CHAT_MODEL_LABEL?.trim();
    const preferredModel = page
      .getByText(requestedModelLabel || "Automatic", { exact: true })
      .first();
    if ((await preferredModel.count()) > 0) {
      await preferredModel.click();
    } else if (requestedModelLabel) {
      expect(
        await preferredModel.count(),
        `configured model ${requestedModelLabel}`,
      ).toBeGreaterThan(0);
    } else {
      // Production may expose only explicitly configured models. Keep the
      // current selection and close setup instead of coupling this journey to
      // a development-only model entry.
      await setup.click();
    }

    const send = async (message: string) => {
      const input = chat.locator("textarea").first();
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await input.fill(message);
      const response = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          candidate.url().endsWith("/api/kody/chat/kody"),
      );
      await chat.getByRole("button", { name: "Send message" }).click();
      expect((await response).status()).toBe(200);
      await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
        timeout: 300_000,
      });
    };

    await send(
      `Copy capability ${copiedSlug} exactly from ${SOURCE.owner}/${SOURCE.repo} to ${target.owner}/${target.repo}. Use the connected-repository copy tool, do not ask me to switch repositories, and show one approval card before writing.`,
    );
    let approve = chat.getByRole("button", { name: "Approve" }).last();
    if (!(await approve.isVisible())) {
      await send(
        `Proceed with that exact cross-repository copy of ${copiedSlug} now and show the approval card.`,
      );
      approve = chat.getByRole("button", { name: "Approve" }).last();
    }
    await expect(approve).toBeVisible({ timeout: 300_000 });
    await expect(
      chat.getByText(
        `Copy ${copiedSlug} from ${SOURCE.owner}/${SOURCE.repo} to ${target.owner}/${target.repo}?`,
        { exact: true },
      ),
    ).toBeVisible();
    await approve.click();
    await expect(approve).toBeDisabled({ timeout: 30_000 });
    await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
      timeout: 300_000,
    });

    const targetCapabilityUrl = `${BASE_URL}/api/kody/capabilities/${copiedSlug}`;
    await expect
      .poll(
        async () =>
          (
            await page.request.get(targetCapabilityUrl, {
              headers: headers(target.owner, target.repo),
            })
          ).status(),
        { timeout: 60_000 },
      )
      .toBe(200);
    const targetDetail = await (
      await page.request.get(targetCapabilityUrl, {
        headers: headers(target.owner, target.repo),
      })
    ).json();
    expect(copyShape(targetDetail)).toEqual(copyShape(sourceDetail));
    await expect(
      chat.getByText(
        `Copied ${copiedSlug} from ${SOURCE.owner}/${SOURCE.repo} to ${target.owner}/${target.repo} and verified the saved target.`,
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    if (copiedSlug) {
      const targetCapabilityUrl = `${BASE_URL}/api/kody/capabilities/${copiedSlug}`;
      if (
        (
          await page.request.get(targetCapabilityUrl, {
            headers: headers(target.owner, target.repo),
          })
        ).status() === 200
      ) {
        expect(
          (
            await page.request.delete(targetCapabilityUrl, {
              headers: headers(target.owner, target.repo),
            })
          ).status(),
        ).toBe(200);
      }
    }
    if (originalAuth) {
      expect(
        (
          await page.request.put(accountUrl, {
            data: { auth: originalAuth },
          })
        ).status(),
      ).toBe(200);
    } else {
      expect((await page.request.delete(accountUrl)).status()).toBe(200);
    }
  }
});
