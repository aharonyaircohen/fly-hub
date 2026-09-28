/**
 * @fileoverview Integration coverage for Brain control routes using stored org.
 * @testFramework vitest
 * @domain brain
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPersonalBrainServices } from "@kody-ade/brain/personal-services";

const brainFly = vi.hoisted(() => ({
  destroyBrain: vi.fn(async () => undefined),
  provisionBrain: vi.fn(async () => undefined),
  resumeBrain: vi.fn(async () => undefined),
  suspendBrain: vi.fn(async () => undefined),
  updateBrainSuspension: vi.fn(async () => ({
    app: "brain-1",
    machineId: "machine-runtime",
    suspendOnIdle: false,
  })),
}));

const brainService = vi.hoisted(() => ({
  resolveBrainService: vi.fn(async (input: { appNameOverride?: string }) => ({
    app: input.appNameOverride ?? "brain-1",
    orgSlug: "guy-koren",
    defaultRegion: "fra",
    flyToken: "fallback-fly-token",
    stored: {
      version: 1,
      appName: "brain-1",
      orgSlug: "guy-koren",
      createdAt: "2026-06-30T00:00:00.000Z",
    },
    state: "running",
    url: "https://brain-1.fly.dev",
    machineId: "machine-runtime",
  })),
}));

const brainStore = vi.hoisted(() => ({
  clearBrainApp: vi.fn(async () => undefined),
}));

const runtimeManager = vi.hoisted(() => ({
  clearBrainRuntimeDeployment: vi.fn(async () => undefined),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  resolveActorFromToken: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "octocat", avatar_url: "", githubId: 1 },
  })),
}));

vi.mock("@kody-ade/fly/plugin/runners/context", () => ({
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "ghp_test",
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  })),
}));

vi.mock("@kody-ade/brain/service-resolver", () => brainService);
vi.mock("@kody-ade/brain/runtime-manager", () => runtimeManager);
vi.mock("@kody-ade/brain/store", () => brainStore);

vi.mock("@kody-ade/fly/plugin/runners/brain", () => brainFly);

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { POST as destroyPOST } from "../../app/api/kody/brain/destroy/route";
import { POST as resumePOST } from "../../app/api/kody/brain/resume/route";
import { POST as suspendPOST } from "../../app/api/kody/brain/suspend/route";
import { POST as suspensionPOST } from "../../app/api/kody/brain/suspension/route";
import { GET as statusGET } from "../../app/api/kody/brain/status/route";

function req(path: string): NextRequest {
  return new NextRequest(`https://dash.test${path}`, { method: "POST" });
}

describe("Brain control routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPersonalBrainServices({
      resolveUser: async () => ({ id: "user-1", label: "Octocat" }),
      getCredential: async () => null,
      getCredentials: async () => ({
        FLY_API_TOKEN: "fly-token",
        GITHUB_TOKEN: "ghp_test",
      }),
      loadState: async () => null,
      saveState: async () => undefined,
    });
  });

  it("reports a missing personal Fly credential without calling Fly", async () => {
    setPersonalBrainServices({
      resolveUser: async () => ({ id: "user-1", label: "Octocat" }),
      getCredential: async () => null,
      getCredentials: async () => ({}),
      loadState: async () => null,
      saveState: async () => undefined,
    });

    const res = await statusGET(
      new NextRequest("https://dash.test/api/kody/brain/status"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "off",
      reason: "fly_token_missing",
      stored: null,
      machines: [],
    });
    expect(brainService.resolveBrainService).not.toHaveBeenCalled();
  });

  it("destroys the stored Brain app in the stored org", async () => {
    const res = await destroyPOST(req("/api/kody/brain/destroy"));

    expect(res.status).toBe(200);
    expect(brainFly.destroyBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        orgSlug: "guy-koren",
      }),
    );
    expect(runtimeManager.clearBrainRuntimeDeployment).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "ghp_test",
    );
  });

  it("destroys the selected Brain app without clearing a different stored Brain", async () => {
    const res = await destroyPOST(
      new NextRequest("https://dash.test/api/kody/brain/destroy", {
        method: "POST",
        body: JSON.stringify({ appName: "brain-extra" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(brainService.resolveBrainService).toHaveBeenCalledWith(
      expect.objectContaining({ appNameOverride: "brain-extra" }),
    );
    expect(brainFly.destroyBrain).toHaveBeenCalledWith(
      expect.objectContaining({ appNameOverride: "brain-extra" }),
    );
    expect(runtimeManager.clearBrainRuntimeDeployment).not.toHaveBeenCalled();
    expect(brainStore.clearBrainApp).not.toHaveBeenCalled();
  });

  it("clears the stored state when the selected app is the active Brain", async () => {
    const res = await destroyPOST(
      new NextRequest("https://dash.test/api/kody/brain/destroy", {
        method: "POST",
        body: JSON.stringify({ appName: "brain-1" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(runtimeManager.clearBrainRuntimeDeployment).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "ghp_test",
    );
    expect(brainStore.clearBrainApp).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "ghp_test",
    );
  });

  it("rejects an invalid selected Brain app name", async () => {
    const res = await destroyPOST(
      new NextRequest("https://dash.test/api/kody/brain/destroy", {
        method: "POST",
        body: JSON.stringify({ appName: "../wrong app" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(brainFly.destroyBrain).not.toHaveBeenCalled();
  });

  it("resumes the stored Brain app in the stored org", async () => {
    const res = await resumePOST(req("/api/kody/brain/resume"));

    expect(res.status).toBe(200);
    expect(brainFly.resumeBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("suspends the stored Brain app in the stored org", async () => {
    const res = await suspendPOST(req("/api/kody/brain/suspend"));

    expect(res.status).toBe(200);
    expect(brainFly.suspendBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("updates suspension on the stored Brain machine without provisioning", async () => {
    const res = await suspensionPOST(
      new NextRequest("https://dash.test/api/kody/brain/suspension", {
        method: "POST",
        headers: { "x-kody-brain-suspension": "never" },
      }),
    );

    expect(res.status).toBe(200);
    expect(brainFly.updateBrainSuspension).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
        suspendOnIdle: false,
      }),
    );
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
  });
});

vi.mock("@kody-ade/brain/agent-access", () => ({
  revokeAgentAccess: vi.fn(async () => undefined),
}));
