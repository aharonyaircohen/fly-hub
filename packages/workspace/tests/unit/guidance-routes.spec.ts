import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  listGuidanceFiles: vi.fn(),
  readGuidanceFile: vi.fn(),
  writeGuidanceFile: vi.fn(),
  deleteGuidanceFile: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: h.requireKodyAuth,
  verifyRepoWriteAccess: h.requireKodyAuth,
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));
vi.mock("../../src/github", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));
vi.mock("../../src/guidance/files", () => ({
  listGuidanceFiles: h.listGuidanceFiles,
  readGuidanceFile: h.readGuidanceFile,
  writeGuidanceFile: h.writeGuidanceFile,
  deleteGuidanceFile: h.deleteGuidanceFile,
  isValidGuidanceSlug: (slug: string) =>
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

import { POST as createConstraint } from "../../src/routes/constraints";
import { POST as createIntent } from "../../src/routes/intents";
import { DELETE as deletePolicy } from "../../src/routes/policy-slug";

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://dash.test/api/kody/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireKodyAuth.mockResolvedValue(null);
  h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
  h.getUserOctokit.mockResolvedValue({ rest: {} });
  h.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "token",
  });
  h.readGuidanceFile.mockResolvedValue(null);
  h.writeGuidanceFile.mockImplementation(async (kind, entry) => ({
    ...entry,
    kind,
  }));
});

describe("agent guidance routes", () => {
  it("normalizes and creates a constraint with an agent audience", async () => {
    const response = await createConstraint(
      request("constraints", "POST", {
        name: "No Force Push",
        body: "Never force push shared branches.",
        agent: ["kody"],
      }),
    );

    expect(response.status).toBe(200);
    expect(h.writeGuidanceFile).toHaveBeenCalledWith("constraint", {
      slug: "no-force-push",
      body: "Never force push shared branches.",
      agent: ["kody"],
    });
  });

  it("creates an intent that applies to every agent", async () => {
    const response = await createIntent(
      request("intents", "POST", {
        name: "Simple Product",
        body: "Keep the product simple.",
        agent: ["*"],
      }),
    );

    expect(response.status).toBe(200);
    expect(h.writeGuidanceFile).toHaveBeenCalledWith("intent", {
      slug: "simple-product",
      body: "Keep the product simple.",
      agent: ["*"],
    });
  });

  it("rejects an empty audience instead of creating unenforced guidance", async () => {
    const response = await createConstraint(
      request("constraints", "POST", {
        name: "No Force Push",
        body: "Never force push shared branches.",
        agent: [],
      }),
    );
    expect(response.status).toBe(400);
    expect(h.writeGuidanceFile).not.toHaveBeenCalled();
  });

  it("does not expose backend error details in a mutation response", async () => {
    h.writeGuidanceFile.mockRejectedValue(
      new Error("CONVEX_URL=https://secret-backend.example"),
    );

    const response = await createConstraint(
      request("constraints", "POST", {
        name: "No Force Push",
        body: "Never force push shared branches.",
        agent: ["kody"],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: "create_failed",
      message: "Create failed.",
    });
    expect(JSON.stringify(payload)).not.toContain("secret-backend");
  });

  it("deletes a policy only after confirming it exists", async () => {
    h.readGuidanceFile.mockResolvedValue({ slug: "release-review" });
    const response = await deletePolicy(
      request("policies/release-review", "DELETE"),
      {
        params: Promise.resolve({ slug: "release-review" }),
      },
    );
    expect(response.status).toBe(200);
    expect(h.deleteGuidanceFile).toHaveBeenCalledWith(
      "policy",
      "release-review",
    );
  });
});
