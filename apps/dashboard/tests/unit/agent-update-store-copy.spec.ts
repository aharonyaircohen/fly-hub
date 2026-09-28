/**
 * @fileoverview Built-in Agent definitions stay immutable while Kody accepts
 * a persisted list of additional configured specialists.
 * @testFramework vitest
 * @domain agents
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  readAgentFile: vi.fn(),
  readResolvedAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
  deleteAgentFile: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: vi.fn(),
  verifyRepoWriteAccess: vi.fn(),
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "widgets" })),
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
}));
vi.mock("@kody-ade/agency/backend/agents-projection", () => ({
  saveProjectedAgent: vi.fn(),
  getProjectedAgent: vi.fn(),
  removeProjectedAgent: vi.fn(),
}));

vi.mock("@kody-ade/agency/github", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

vi.mock("@kody-ade/agency/agent-files", () => ({
  readAgentFile: h.readAgentFile,
  readResolvedAgentFile: h.readResolvedAgentFile,
  // The route now lists all resolved agents and picks by slug; derive the
  // list from the same per-slug mock so existing test setups keep working.
  listResolvedAgentFiles: async () => {
    const agent = await h.readResolvedAgentFile("kody");
    return agent
      ? [
          agent,
          {
            slug: "custom-specialist",
            title: "Custom Specialist",
            body: "Handles custom work.",
            whenToUse: "Use for custom work.",
          },
          {
            slug: "context-scout",
            title: "Context Scout",
            body: "Finds context.",
            whenToUse: "Use for context.",
          },
        ]
      : [];
  },
  writeAgentFile: h.writeAgentFile,
  deleteAgentFile: h.deleteAgentFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@kody-ade/base/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { PATCH } from "../../app/api/kody/agents/[slug]/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://dash.test/api/kody/agents/kody", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ slug: "kody" });

describe("PATCH /api/kody/agents/[slug] — built-in agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.verifyActorLogin.mockResolvedValue("admin");
    h.getUserOctokit.mockResolvedValue({});
  });

  it("stores only Kody's additional specialists", async () => {
    h.readResolvedAgentFile.mockResolvedValue({
      slug: "kody",
      title: "Kody",
      body: "Built-in identity",
      subagents: ["context-scout", "custom-specialist"],
      lockedSubagents: ["context-scout"],
      sha: "",
      updatedAt: "",
      htmlUrl: "",
      source: "builtin",
      readOnly: true,
    });
    h.writeAgentFile.mockResolvedValue({
      slug: "kody",
      title: "Kody",
      body: "Built-in identity",
      sha: "abc123",
    });

    const res = await PATCH(
      request({ subagents: ["context-scout", "custom-specialist"] }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "kody",
        body: "Built-in identity",
        subagents: ["custom-specialist"],
      }),
    );
  });

  it("rejects edits to Kody's built-in identity", async () => {
    h.readResolvedAgentFile.mockResolvedValue({
      slug: "kody",
      title: "Kody",
      body: "Built-in identity",
      source: "builtin",
      readOnly: true,
      subagents: ["context-scout"],
      lockedSubagents: ["context-scout"],
    });

    const res = await PATCH(request({ body: "Custom identity" }), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("builtin_agent_locked");
    expect(h.writeAgentFile).not.toHaveBeenCalled();
  });

  it("still 404s when the agent exists nowhere", async () => {
    h.readResolvedAgentFile.mockResolvedValue(null);

    const res = await PATCH(request({ body: "x" }), { params });

    expect(res.status).toBe(404);
    expect(h.writeAgentFile).not.toHaveBeenCalled();
  });
});
