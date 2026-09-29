import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flyHubAppName,
  inspectPublicGitHubApp,
  parsePublicGitHubRepo,
} from "../../src/hub/app-source";

afterEach(() => vi.unstubAllGlobals());

describe("Fly Hub public repository inspection", () => {
  it("accepts only a repository URL and assigns a stable org-scoped name", () => {
    expect(parsePublicGitHubRepo("https://github.com/acme/site")).toEqual({
      owner: "acme",
      repo: "site",
    });
    expect(() =>
      parsePublicGitHubRepo("https://example.com/acme/site"),
    ).toThrow("public github.com");
    expect(flyHubAppName("org-a", "acme", "site", ".")).not.toBe(
      flyHubAppName("org-b", "acme", "site", "."),
    );
  });

  it("pins a public Node app to a commit before deployment", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/site"))
        return Response.json({ default_branch: "main", private: false });
      if (url.endsWith("/repos/acme/site/branches/main"))
        return Response.json({
          commit: { sha: "a".repeat(40), tree: { sha: "tree-sha" } },
        });
      if (url.includes("/git/trees/tree-sha"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "package.json", type: "blob", size: 100 },
            { path: ".env.example", type: "blob", size: 20 },
          ],
        });
      if (url.endsWith("/package.json"))
        return new Response(
          JSON.stringify({ scripts: { start: "node server.js" } }),
        );
      if (url.endsWith("/.env.example")) return new Response("API_KEY=\n");
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await inspectPublicGitHubApp({
      url: "https://github.com/acme/site",
      org: "personal",
    });
    expect(result.commitSha).toBe("a".repeat(40));
    expect(result.plan.kind).toBe("node");
    expect(result.requiredSecretNames).toEqual(["API_KEY"]);
    expect(result.appName).toMatch(/^flyhub-app-acme-site-[a-f0-9]{12}$/);
  });
});
