import { describe, expect, it } from "vitest";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@kody-ade/base/thread-link", () => ({
  dashboardTaskUrl: () => "/tasks/test",
}));

import { buildSystemPrompt } from "../src/kody-system-prompt";

describe("Kody system prompt preview ownership", () => {
  it("makes embedded preview context authoritative for what the user sees", () => {
    const prompt = buildSystemPrompt("Kody", null, undefined, {
      currentPage: "the Views page (/preview/demo)",
      previewContext:
        "Current browser URL: https://www.iana.org/help/example-domains",
    });

    expect(prompt).toContain("The preview reference is the page the user sees");
    expect(prompt).toContain("https://www.iana.org/help/example-domains");
  });
});

describe("Kody system prompt App context", () => {
  it("includes safe selected-App metadata without credential values", () => {
    const prompt = buildSystemPrompt(
      "Kody",
      { owner: "acme", repo: "site" },
      undefined,
      {
        app: {
          slug: "storefront",
          repository: "lfnovo/open-notebook",
          name: "Storefront",
          status: "running",
          branch: "main",
          rootDirectory: "apps/web",
          exposure: "private",
          currentDeploymentId: "deployment-id",
          secretNames: ["DATABASE_URL"],
          domains: [{ hostname: "shop.example.com", status: "ready" }],
          storage: [
            { volumeId: "vol_1", name: "data", mountPath: "/data", sizeGb: 10 },
          ],
        },
      },
    );

    expect(prompt).toContain("## Current App");
    expect(prompt).toContain("Storefront");
    expect(prompt).toContain("DATABASE_URL");
    expect(prompt).toContain(
      "Never claim to know secret values or consumer tokens",
    );
    expect(prompt).not.toContain("kody_app_");
  });
});
