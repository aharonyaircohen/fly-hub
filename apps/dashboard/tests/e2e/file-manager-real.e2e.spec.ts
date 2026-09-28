import { Octokit } from "@octokit/rest";

import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string): { owner: string; repo: string } {
  try {
    const path = value.includes("://") ? new URL(value).pathname : value;
    const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return { owner: "", repo: "" };
  }
}

test("creates, moves, deletes, and cleans up real repository files", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires explicit live target and repository credentials",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  page.setDefaultTimeout(30_000);
  const headers = {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  const octokit = new Octokit({ auth: TEST_TOKEN });
  const marker = `kody-file-manager-e2e-${Date.now()}`;
  const folderPath = marker;
  const fileName = `${marker}.md`;
  const uploadedFileName = `${marker}-uploaded.md`;
  const uploadedFilePath = `${folderPath}/${uploadedFileName}`;
  const nestedFilePath = `${folderPath}/${fileName}`;
  const rootFilePath = `${marker}.md`;

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

  async function deleteIfPresent(path: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });
        if (Array.isArray(response.data)) return;
        await octokit.rest.repos.deleteFile({
          owner,
          repo,
          path,
          sha: response.data.sha,
          message: `test: clean up ${path}`,
        });
        return;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) return;
        if (status !== 409 || attempt === 2) throw error;
      }
    }
  }

  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/files`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();

    await page
      .getByRole("button", { name: "New folder", exact: true })
      .last()
      .click();
    const folderDialog = page.getByRole("dialog", { name: "New folder" });
    await folderDialog
      .getByPlaceholder("folder-name or nested/path")
      .fill(folderPath);
    await folderDialog.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(new RegExp(`/files/${folderPath}$`));

    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Upload", exact: true }).click();
    await page.getByRole("button", { name: "Set destination" }).click();
    await expect(page.getByLabel("Upload destination")).toHaveValue(folderPath);
    await page
      .locator('input[type="file"][aria-label="Choose files to upload"]')
      .setInputFiles({
        name: uploadedFileName,
        mimeType: "text/markdown",
        buffer: Buffer.from("# Uploaded by the file manager\n"),
      });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: `Uploaded ${uploadedFileName}` }),
    ).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => {
        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: uploadedFilePath,
          });
          return Array.isArray(response.data) ? null : response.data.path;
        } catch (error) {
          if ((error as { status?: number }).status === 404) return null;
          throw error;
        }
      })
      .toBe(uploadedFilePath);
    await deleteIfPresent(uploadedFilePath);

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/files/${folderPath}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "New file", exact: true })
      .last()
      .click();
    const fileDialog = page.getByRole("dialog", { name: "New file" });
    await fileDialog
      .getByPlaceholder("filename.txt or nested/path.txt")
      .fill(fileName);
    await fileDialog.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(new RegExp(`/files/${nestedFilePath}$`));
    await expect
      .poll(async () => {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: nestedFilePath,
        });
        return Array.isArray(response.data) ? null : response.data.path;
      })
      .toBe(nestedFilePath);

    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Rename or move" }).click();
    const moveDialog = page.getByRole("dialog", { name: "Rename or move" });
    await moveDialog.getByRole("textbox").fill(rootFilePath);
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: `Moved ${nestedFilePath} to ${rootFilePath}` }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/files/${rootFilePath}$`));
    await expect
      .poll(async () => {
        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: rootFilePath,
          });
          return Array.isArray(response.data) ? null : response.data.path;
        } catch {
          return null;
        }
      })
      .toBe(rootFilePath);

    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteFileDialog = page.getByRole("dialog", { name: "Delete file" });
    await deleteFileDialog.getByRole("button", { name: "Delete" }).click();
    await expect(deleteFileDialog).toBeHidden();
    const deleteToasts = await page
      .locator("[data-sonner-toast]")
      .allTextContents();
    expect(deleteToasts).toContain(`Deleted ${rootFilePath}`);
    await expect
      .poll(async () => {
        try {
          await octokit.rest.repos.getContent({
            owner,
            repo,
            path: rootFilePath,
          });
          return true;
        } catch (error) {
          return (error as { status?: number }).status !== 404;
        }
      })
      .toBe(false);

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/files/${folderPath}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(new RegExp(`/files/${folderPath}$`));
    await expect(page.getByText("Folder", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("treeitem").filter({ hasText: ".gitkeep" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteFolderDialog = page.getByRole("dialog", {
      name: "Delete folder",
    });
    await deleteFolderDialog.getByRole("button", { name: "Delete" }).click();
    await expect(deleteFolderDialog).toBeHidden();

    await expect
      .poll(async () => {
        try {
          await octokit.rest.repos.getContent({
            owner,
            repo,
            path: folderPath,
          });
          return true;
        } catch (error) {
          return (error as { status?: number }).status !== 404;
        }
      })
      .toBe(false);
  } finally {
    await deleteIfPresent(rootFilePath);
    await deleteIfPresent(uploadedFilePath);
    await deleteIfPresent(nestedFilePath);
    await deleteIfPresent(`${folderPath}/.gitkeep`);
  }
});
