/**
 * @fileoverview Unit tests for creating agent entries.
 * @testFramework vitest
 * @domain agents
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOctokit: vi.fn(() => ({ rest: {} })),
  listResolvedAgentFiles: vi.fn(),
  readAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
  getEngineConfig: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  verifyRepoReadAccess: h.requireKodyAuth,
  verifyRepoWriteAccess: h.requireKodyAuth,
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));

vi.mock("@kody-ade/agency/github", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
  getOctokit: h.getOctokit,
}));

vi.mock("@kody-ade/agency/agent-files", () => ({
  listResolvedAgentFiles: h.listResolvedAgentFiles,
  readAgentFile: h.readAgentFile,
  writeAgentFile: h.writeAgentFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
}));

vi.mock("@kody-ade/base/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));
import { GET, POST } from "../../app/api/kody/agents/route";

function listRequest() {
  return new NextRequest("https://dash.test/api/kody/agents", {
    headers: {
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

function request(body: Record<string, unknown>) {
  return new NextRequest("https://dash.test/api/kody/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/kody/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
    h.getEngineConfig.mockResolvedValue({
      config: { company: { activeAgents: ["store-on"] } },
      sha: "config-sha",
    });
    h.listResolvedAgentFiles.mockResolvedValue([
      { slug: "local-one", source: "local" },
      { slug: "store-on", source: "store" },
    ]);
  });

  it("lists local agents and active Store agents only", async () => {
    const res = await GET(listRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agent.map((entry: { slug: string }) => entry.slug)).toEqual([
      "local-one",
      "store-on",
    ]);
    expect(h.getEngineConfig).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
    );
    expect(h.listResolvedAgentFiles).toHaveBeenCalledWith({
      activeStoreSlugs: new Set(["store-on"]),
    });
  });

  it("exposes built-in Agents but no Store agents in a new repository", async () => {
    h.getEngineConfig.mockResolvedValue({
      config: { company: {} },
      sha: null,
    });
    h.listResolvedAgentFiles.mockImplementation(
      async (options?: { activeStoreSlugs?: Set<string> }) =>
        options?.activeStoreSlugs?.has("store-on")
          ? [{ slug: "store-on", source: "store" }]
          : [
              { slug: "kody", source: "builtin" },
              { slug: "repository-analyst", source: "builtin" },
            ],
    );

    const res = await GET(listRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agent).toEqual([
      { slug: "kody", source: "builtin" },
      { slug: "repository-analyst", source: "builtin" },
    ]);
    expect(h.listResolvedAgentFiles).toHaveBeenCalledWith({
      activeStoreSlugs: new Set(),
    });
  });
});

describe("POST /api/kody/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readAgentFile.mockResolvedValue(null);
    h.listResolvedAgentFiles.mockResolvedValue([
      {
        slug: "kody",
        title: "Kody",
        body: "Coordinates specialists.",
        source: "builtin",
        readOnly: true,
      },
      {
        slug: "agency-specialist",
        title: "Agency Specialist",
        body: "Manages the Agency.",
        whenToUse: "Use for Agency governance.",
      },
      {
        slug: "repo-scout",
        title: "Repository Scout",
        body: "Reads repository files.",
        whenToUse: "Use for repository research.",
      },
    ]);
    h.writeAgentFile.mockImplementation(async ({ slug, title, body }) => ({
      slug,
      title,
      body,
      sha: "agent-sha",
      updatedAt: "2026-07-09T00:00:00.000Z",
      htmlUrl: `https://github.com/acme/widgets/blob/main/agents/${slug}.md`,
    }));
  });

  it("creates an agent when a create surface sends a blank slug with a non-ascii title", async () => {
    const res = await POST(
      request({
        slug: "",
        title: "סוכן בדיקות",
        body: "Runs QA checks.",
        actorLogin: "alice",
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agentMember.slug).toMatch(/^agent-[a-z0-9]+$/);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.stringMatching(/^agent-[a-z0-9]+$/),
        title: "סוכן בדיקות",
        body: "Runs QA checks.",
      }),
    );
    expect(h.getUserOctokit).not.toHaveBeenCalled();
  });

  it("normalizes an invalid requested slug instead of returning invalid_slug", async () => {
    const res = await POST(
      request({
        slug: "סוכן בדיקות",
        title: "QA Agent",
        body: "Runs QA checks.",
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agentMember.slug).toMatch(/^agent-[a-z0-9]+$/);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.stringMatching(/^agent-[a-z0-9]+$/),
        title: "QA Agent",
      }),
    );
  });

  it("stores routing guidance and assigned public subagents", async () => {
    const res = await POST(
      request({
        slug: "coordinator",
        title: "Coordinator",
        body: "Coordinates the team.",
        whenToUse: "Use for cross-team coordination.",
        subagents: ["agency-specialist", "repo-scout"],
      }),
    );

    expect(res.status).toBe(200);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "coordinator",
        whenToUse: "Use for cross-team coordination.",
        subagents: ["agency-specialist", "repo-scout"],
      }),
    );
  });

  it("rejects assigning an agent to itself", async () => {
    const res = await POST(
      request({
        slug: "parent-agent",
        title: "Parent Agent",
        body: "Coordinates the team.",
        subagents: ["parent-agent"],
      }),
    );

    expect(res.status).toBe(400);
    expect(h.writeAgentFile).not.toHaveBeenCalled();
  });

  it("rejects assigning a specialist without routing guidance", async () => {
    h.listResolvedAgentFiles.mockResolvedValue([
      { slug: "unclear-agent", title: "Unclear", body: "Does things." },
    ]);

    const res = await POST(
      request({
        slug: "coordinator",
        title: "Coordinator",
        body: "Coordinates the team.",
        subagents: ["unclear-agent"],
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("subagent_routing_required");
    expect(h.writeAgentFile).not.toHaveBeenCalled();
  });

  it("does not let local configuration replace a built-in Agent", async () => {
    const res = await POST(
      request({ slug: "kody", title: "Custom Kody", body: "Override." }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("builtin_agent_locked");
    expect(h.writeAgentFile).not.toHaveBeenCalled();
  });
});
