/**
 * @fileoverview Unit tests for capability API routes.
 * @testFramework vitest
 * @domain capabilities
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
  companyStoreAssetPath: vi.fn(
    async (_octokit: unknown, kind: string, slug: string) => `${kind}/${slug}`,
  ),
  readCompanyStoreText: vi.fn(),
  listStoredAgencyDefinitions: vi.fn(),
  listCapabilityFiles: vi.fn(),
  readCapabilityFile: vi.fn(),
  readResolvedCapabilityFile: vi.fn(),
  writeCapabilityFile: vi.fn(),
  writeCapabilityFolderFiles: vi.fn(),
  deleteCapabilityFile: vi.fn(),
  resolveInstalledCapabilitySlugs: vi.fn(),
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(),
  getProjectedEngineConfig: vi.fn(),
  listProjectedCapabilities: vi.fn(),
  getProjectedCapability: vi.fn(),
  saveProjectedCapability: vi.fn(),
  recordAudit: vi.fn(),
  backendQuery: vi.fn(),
  backendMutation: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: h.requireKodyAuth,
  verifyRepoWriteAccess: h.requireKodyAuth,
  requireKodyAuth: h.requireKodyAuth,
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));

vi.mock("@kody-ade/agency/github", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
  getOctokit: h.getOctokit,
}));
vi.mock("@kody-ade/base/company-store/assets", () => ({
  companyStoreAssetPath: h.companyStoreAssetPath,
  readCompanyStoreText: h.readCompanyStoreText,
}));
vi.mock("@kody-ade/agency/backend/agency-model-store", () => ({
  listStoredAgencyDefinitions: h.listStoredAgencyDefinitions,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
  getOctokit: h.getOctokit,
}));

vi.mock("@kody-ade/agency/capabilities", () => ({
  listCapabilityFiles: h.listCapabilityFiles,
  readCapabilityFile: h.readCapabilityFile,
  readResolvedCapabilityFile: h.readResolvedCapabilityFile,
  writeCapabilityFile: h.writeCapabilityFile,
  writeCapabilityFolderFiles: h.writeCapabilityFolderFiles,
  deleteCapabilityFile: h.deleteCapabilityFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  PERMISSION_MODES: ["default", "acceptEdits", "plan", "bypassPermissions"],
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/company-store/installed-capabilities", () => ({
  resolveInstalledCapabilitySlugs: h.resolveInstalledCapabilitySlugs,
}));

vi.mock("@dashboard/lib/backend/repo-projection", () => ({
  getProjectedEngineConfig: h.getProjectedEngineConfig,
  listProjectedCapabilities: h.listProjectedCapabilities,
  getProjectedCapability: h.getProjectedCapability,
  saveProjectedCapability: h.saveProjectedCapability,
}));

vi.mock("@kody-ade/base/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));
vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    catalog: {
      get: "catalog:get",
      remove: "catalog:remove",
      save: "catalog:save",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: h.backendQuery,
    mutation: h.backendMutation,
  }),
}));

import { GET, POST } from "../../app/api/kody/capabilities/route";
import {
  DELETE,
  GET as GET_DETAIL,
  PATCH,
} from "../../app/api/kody/capabilities/[slug]/route";

function authHeaders() {
  return {
    "x-kody-token": "ghp_test-token",
    "x-kody-owner": "acme",
    "x-kody-repo": "widgets",
  };
}

function request(
  url: string,
  init: { method?: string; body?: BodyInit | null; headers?: HeadersInit } = {},
) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
}

function params(slug = "ship-feature") {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /api/kody/capabilities", () => {
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
    h.getProjectedCapability.mockResolvedValue(null);
    h.saveProjectedCapability.mockResolvedValue(undefined);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeCapabilities: ["store-on"],
        },
      },
      sha: "config-sha",
    });
    h.resolveInstalledCapabilitySlugs.mockResolvedValue(new Set(["store-on"]));
    h.getProjectedEngineConfig.mockResolvedValue({
      config: { company: { activeCapabilities: ["store-on"] } },
      sha: null,
    });
    h.listCapabilityFiles.mockResolvedValue([
      { slug: "local-one", source: "local" },
      { slug: "store-on", source: "store" },
    ]);
  });

  it("lists local capabilities and active Store capabilities only", async () => {
    const res = await GET(request("https://dash.test/api/kody/capabilities"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(
      json.capabilities.map((entry: { slug: string }) => entry.slug),
    ).toEqual(["local-one", "store-on"]);
    expect(json.implementations).toBeUndefined();
    expect(h.getEngineConfig).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
    );
    expect(h.resolveInstalledCapabilitySlugs).toHaveBeenCalledWith(
      { rest: {} },
      expect.objectContaining({
        company: { activeCapabilities: ["store-on"] },
      }),
    );
    expect(h.listCapabilityFiles).toHaveBeenCalledWith({
      activeStoreSlugs: new Set(["store-on"]),
    });
  });

  it("does not expose Store capabilities in a new repository", async () => {
    h.getEngineConfig.mockResolvedValue({
      config: { company: {} },
      sha: null,
    });
    h.resolveInstalledCapabilitySlugs.mockResolvedValue(new Set());
    h.listCapabilityFiles.mockImplementation(
      async (options?: { activeStoreSlugs?: Set<string> }) =>
        options?.activeStoreSlugs?.has("store-on")
          ? [{ slug: "store-on", source: "store" }]
          : [],
    );

    const res = await GET(request("https://dash.test/api/kody/capabilities"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.capabilities).toEqual([]);
    expect(h.listCapabilityFiles).toHaveBeenCalledWith({
      activeStoreSlugs: new Set(),
    });
  });
});

describe("POST /api/kody/capabilities", () => {
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
    h.readCapabilityFile.mockResolvedValueOnce(null).mockResolvedValueOnce({
      slug: "ship-feature",
      describe: "Ship feature",
    });
  });

  it("creates capability files through the capability storage helper", async () => {
    const res = await POST(
      request("https://dash.test/api/kody/capabilities", {
        method: "POST",
        body: JSON.stringify({
          slug: "ship-feature",
          instructions: "# Ship feature",
          skills: [],
          tools: [],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ capability: { slug: "ship-feature" } });
    expect(json).not.toHaveProperty("implementation");
    expect(h.writeCapabilityFolderFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "ship-feature",
        files: {
          "instructions.md": "# Ship feature\n",
          "contract.json":
            JSON.stringify(
              { execution: "agent", input: {}, output: {} },
              null,
              2,
            ) + "\n",
        },
      }),
    );
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "capability.create",
        resource: "ship-feature",
      }),
    );
  });

  it("preserves an explicitly absent capability contract", async () => {
    const res = await POST(
      request("https://dash.test/api/kody/capabilities", {
        method: "POST",
        body: JSON.stringify({
          slug: "ship-feature",
          instructions: "# Ship feature",
          contract: null,
          skills: [],
          tools: [],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(h.writeCapabilityFolderFiles).toHaveBeenCalledWith({
      slug: "ship-feature",
      files: {
        "instructions.md": "# Ship feature\n",
      },
    });
  });
});

describe("GET /api/kody/capabilities/[slug]", () => {
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
    h.readResolvedCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      instructions: "# Ship feature",
      skills: [],
      capabilityTools: [],
    });
    h.getEngineConfig.mockResolvedValue({
      config: { execution: {} },
      sha: "config-sha",
    });
    h.listStoredAgencyDefinitions.mockResolvedValue([
      {
        recordId: "capability:ship-feature:revision",
        kind: "capability",
        schemaVersion: 1,
        data: { id: "ship-feature" },
        createdAt: "2026-07-23T00:00:00.000Z",
      },
      {
        recordId: "implementation:ship-feature-runner:revision",
        kind: "implementation",
        schemaVersion: 1,
        data: {
          id: "ship-feature-runner",
          capabilityRef: { kind: "capability", id: "ship-feature" },
          compatibleCapabilityRevision: "revision",
          type: "agent",
          agentRef: { kind: "agent", id: "kody" },
        },
        createdAt: "2026-07-23T00:00:00.000Z",
      },
    ]);
    h.readCompanyStoreText.mockImplementation(async (_octokit, path: string) =>
      path.endsWith("runtime.json")
        ? JSON.stringify({ adapter: "kody-engine-profile" })
        : "Run the task.",
    );
  });

  it("loads one simple Store capability folder with repository context", async () => {
    const response = await GET_DETAIL(
      request("https://dash.test/api/kody/capabilities/ship-feature"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(h.setGitHubContext).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "ghp_test-token",
      "https://github.com/acme/kody-store",
      "stable",
    );
    expect(body.capability).toMatchObject({
      slug: "ship-feature",
      instructions: "# Ship feature",
    });
    expect(body.capability).not.toHaveProperty("simpleContract");
    expect(body.capability).not.toHaveProperty("implementationResolution");
    expect(h.clearGitHubContext).toHaveBeenCalled();
  });
});

describe("DELETE /api/kody/capabilities/[slug]", () => {
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
  });

  it("deletes the Convex capability projection", async () => {
    h.readCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
    });
    h.readResolvedCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
    });

    const res = await DELETE(
      request(
        "https://dash.test/api/kody/capabilities/ship-feature?actorLogin=alice",
        { method: "DELETE" },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteCapabilityFile).toHaveBeenCalledWith("ship-feature");
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "capability.delete",
        resource: "ship-feature",
      }),
    );
  });

  it("detaches an active Store capability without deleting the Store item", async () => {
    h.readCapabilityFile.mockResolvedValue(null);
    h.readResolvedCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      source: "store",
    });
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: { activeCapabilities: ["ship-feature", "review"] },
      },
      sha: "config-sha",
    });

    const res = await DELETE(
      request(
        "https://dash.test/api/kody/capabilities/ship-feature?actorLogin=alice",
        { method: "DELETE" },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      removedStoreReference: true,
    });
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
      { activeCapabilities: ["review"] },
      "chore(kody): remove store capability ship-feature",
    );
    expect(h.deleteCapabilityFile).not.toHaveBeenCalled();
  });

  it("replaces the capability folder", async () => {
    h.readResolvedCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
      instructions: "# Ship feature",
      skills: [],
      capabilityTools: [],
    });

    const res = await PATCH(
      request("https://dash.test/api/kody/capabilities/ship-feature", {
        method: "PATCH",
        body: JSON.stringify({
          instructions: "# Ship updated feature",
          skills: [],
          tools: [],
          actorLogin: "alice",
        }),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(h.writeCapabilityFolderFiles).toHaveBeenCalled();
  });
});
