import { test, expect } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3333";
const token = process.env.E2E_GITHUB_TOKEN ?? process.env.KODY_BOT_TOKEN ?? "";
const repoUrl =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/aharonyaircohen/kody-chat";
const [, owner, repo] = new URL(repoUrl).pathname.split("/");

test("static view upload, read, and delete use Convex", async ({ request }) => {
  test.skip(!token, "E2E_GITHUB_TOKEN or KODY_BOT_TOKEN is required");
  const headers = {
    "x-kody-token": token,
    "x-kody-owner": owner!,
    "x-kody-repo": repo!,
  };
  const upload = await request.post(`${baseUrl}/api/kody/views`, {
    headers,
    multipart: {
      label: `convex-e2e-${Date.now()}`,
      file: {
        name: "index.html",
        mimeType: "text/html",
        buffer: Buffer.from("<h1>Convex view proof</h1>"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const created = await upload.json();
  const viewId = created.id as string;

  try {
    const read = await request.get(
      `${baseUrl}/api/kody/views/${viewId}/index.html`,
      { headers },
    );
    expect(read.status()).toBe(200);
    expect(await read.text()).toContain("Convex view proof");
  } finally {
    const removed = await request.delete(
      `${baseUrl}/api/kody/views?view=${viewId}`,
      { headers },
    );
    expect(removed.status()).toBe(200);
  }
});
