import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("kody_auth", JSON.stringify({
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "connections-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    }));
  });
}

test("configures Facebook and Instagram Connections without accepting token values", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await seedAuth(page);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, { authenticated: true, user: { login: "connections-e2e", avatar_url: "", githubId: 1 } }),
  );
  await page.route("https://api.github.com/user", (route) =>
    json(route, { login: "connections-e2e", avatar_url: "", id: 1 }),
  );
  await page.route("**/api/kody/secrets", (route) =>
    json(route, { secrets: [{ name: "FACEBOOK_PAGE_ACCESS_TOKEN" }, { name: "INSTAGRAM_ACCESS_TOKEN" }] }),
  );

  const connections = new Map<string, Record<string, unknown>>();
  const savedBodies: Record<string, Record<string, unknown>> = {};
  await page.route("**/api/kody/connections", async (route) => {
    if (route.request().method() === "PUT") {
      const savedBody = route.request().postDataJSON() as Record<string, unknown>;
      const connection = {
        id: savedBody.id,
        name: savedBody.name,
        provider: savedBody.provider,
        accountType: savedBody.accountType,
        externalId: savedBody.externalId,
        credentialRefs: savedBody.credentialRefs,
        status: "needs_attention",
        verifiedAt: null,
      };
      connections.set(String(savedBody.id), connection);
      savedBodies[String(savedBody.id)] = savedBody;
      return json(route, { ok: true, connection });
    }
    return json(route, { connections: [...connections.values()] });
  });
  await page.route("**/api/kody/connections/facebook-main/verify", (route) => {
    const connection = { ...connections.get("facebook-main"), status: "connected", verifiedAt: "2026-08-31T12:00:00.000Z" };
    connections.set("facebook-main", connection);
    return json(route, { ok: true, connection });
  });
  await page.route("**/api/kody/connections/instagram-main/verify", (route) => {
    const connection = { ...connections.get("instagram-main"), status: "connected", verifiedAt: "2026-08-31T12:00:00.000Z" };
    connections.set("instagram-main", connection);
    return json(route, { ok: true, connection });
  });

  const catalogResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/kody/models" &&
      url.searchParams.get("catalog") === "opencode-free";
  });
  await page.goto(`${BASE_URL}/repo/test-owner/test-repo/connections`);
  expect((await catalogResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  const contentGroup = page.getByRole("button", { name: "Content" });
  if ((await contentGroup.getAttribute("aria-expanded")) !== "true") await contentGroup.click();
  await expect(page.getByRole("link", { name: "Connections" })).toHaveAttribute(
    "href", "/repo/test-owner/test-repo/connections",
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText("FACEBOOK_PAGE_ACCESS_TOKEN")).toBeVisible();
  await expect(page.getByText("INSTAGRAM_ACCESS_TOKEN")).toBeVisible();

  const facebookCard = page.locator('[aria-label="Facebook Page connection"]');
  await facebookCard.getByRole("textbox", { name: "Name" }).fill("Simulated Reality");
  await facebookCard.getByRole("textbox", { name: "Facebook Page ID" }).fill("123456789");
  await facebookCard.getByRole("button", { name: "Save Connection" }).click();
  await expect(page.getByText("Facebook Page connection saved", { exact: true })).toBeVisible();
  expect(savedBodies["facebook-main"]).toEqual({
    id: "facebook-main",
    name: "Simulated Reality",
    provider: "facebook",
    accountType: "page",
    externalId: "123456789",
    credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
    actorLogin: "connections-e2e",
  });
  expect(savedBodies["facebook-main"]).not.toHaveProperty("accessToken");
  await facebookCard.getByRole("button", { name: "Verify Connection" }).click();

  const instagramCard = page.locator('[aria-label="Instagram connection"]');
  await instagramCard.getByRole("textbox", { name: "Name" }).fill("Kody Creator");
  await instagramCard.getByRole("textbox", { name: "Instagram account ID" }).fill("17841400000000000");
  await instagramCard.getByRole("button", { name: "Save Connection" }).click();
  await expect(page.getByText("Instagram connection saved", { exact: true })).toBeVisible();
  expect(savedBodies["instagram-main"]).toEqual({
    id: "instagram-main",
    name: "Kody Creator",
    provider: "instagram",
    accountType: "professional",
    externalId: "17841400000000000",
    credentialRefs: { accessToken: "INSTAGRAM_ACCESS_TOKEN" },
    actorLogin: "connections-e2e",
  });
  await instagramCard.getByRole("button", { name: "Verify Connection" }).click();
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(2);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
