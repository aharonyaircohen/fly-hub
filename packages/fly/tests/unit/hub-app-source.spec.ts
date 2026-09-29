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
          commit: {
            sha: "a".repeat(40),
            commit: { tree: { sha: "tree-sha" } },
          },
        });
      if (url.includes("/git/trees/tree-sha"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "package.json", type: "blob", size: 100 },
            { path: ".env.example", type: "blob", size: 20 },
            { path: "examples/demo/.env.example", type: "blob", size: 20 },
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
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("examples/demo/.env.example"),
      expect.anything(),
    );
    expect(result.appName).toMatch(/^flyhub-app-acme-site-[a-f0-9]{12}$/);
  });

  it("holds a Docker image with no default web command or port", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/agent"))
        return Response.json({ default_branch: "main", private: false });
      if (url.endsWith("/repos/acme/agent/branches/main"))
        return Response.json({
          commit: {
            sha: "b".repeat(40),
            commit: { tree: { sha: "agent-tree" } },
          },
        });
      if (url.includes("/git/trees/agent-tree"))
        return Response.json({
          truncated: false,
          tree: [{ path: "Dockerfile", type: "blob", size: 60 }],
        });
      if (url.endsWith("/Dockerfile"))
        return new Response('FROM python:3.13\nENTRYPOINT ["/entrypoint.sh"]\nCMD []\n');
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await inspectPublicGitHubApp({
      url: "https://github.com/acme/agent",
      org: "personal",
    });
    expect(result.plan.kind).toBe("dockerfile");
    expect(result.plan.questions).toEqual([
      "This Dockerfile has no default web command or HTTP port. Which service should run, and on what port?",
    ]);
  });
});
