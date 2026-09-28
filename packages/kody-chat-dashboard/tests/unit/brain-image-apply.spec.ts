/**
 * @fileoverview Unit coverage for explicit Brain image apply.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  markBrainImageRunning: vi.fn(),
  readBrainApp: vi.fn(),
  readBrainImage: vi.fn(),
  selectBrainImage: vi.fn(),
  writeBrainApp: vi.fn(),
  writeBrainImage: vi.fn(),
}));

const runtimeManager = vi.hoisted(() => ({
  readBrainRuntimeView: vi.fn(async () => ({
    desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
    source: "runtime",
  })),
  beginBrainRuntimeApply: vi.fn(async () => ({ operation: { id: "apply-1" } })),
  completeBrainRuntimeApply: vi.fn(
    async (
      _login: string,
      _token: string,
      input: {
        imageRef: string;
        app: string;
        machineId: string;
        orgSlug: string;
        url?: string;
      },
    ) => ({
      version: 1,
      desiredImageRef: input.imageRef,
      running: {
        imageRef: input.imageRef,
        app: input.app,
        machineId: input.machineId,
        orgSlug: input.orgSlug,
        url: input.url,
        appliedAt: "2026-07-02T00:00:00.000Z",
      },
      updatedAt: "2026-07-02T00:00:00.000Z",
    }),
  ),
  failBrainRuntimeApply: vi.fn(async () => undefined),
  resumeBrainRuntimeApply: vi.fn(),
  setBrainRuntimeApplyStage: vi.fn(async () => undefined),
}));

const runtime = vi.hoisted(() => ({
  brainFlyRuntimeImageRef: vi.fn(
    ({ app, imageRef }: { app: string; imageRef: string }) =>
      `registry.fly.io/${app}:${imageRef.split(":").at(-1)}`,
  ),
  brainGhcrAuth: vi.fn(() => ({ token: "ghcr-token", user: "octocat" })),
  prepareBrainRuntimeImage: vi.fn(async () => undefined),
}));

const brainFly = vi.hoisted(() => ({
  provisionBrain: vi.fn(),
  waitForBrainHealth: vi.fn(async () => undefined),
}));

const serviceResolver = vi.hoisted(() => ({
  resolveBrainService: vi.fn(),
}));

const catalog = vi.hoisted(() => ({
  brainImageCatalogFile: vi.fn(
    ({
      previous,
      images,
      updatedAt = "2026-07-05T12:53:01.000Z",
    }: {
      previous: { createdAt?: string; forgottenImageRefs?: string[] } | null;
      images: Array<{ imageRef: string; createdAt: string; updatedAt: string }>;
      updatedAt?: string;
    }) => ({
      version: 1,
      createdAt: previous?.createdAt ?? images[0]?.createdAt ?? updatedAt,
      updatedAt,
      images,
      ...(previous?.forgottenImageRefs?.length
        ? { forgottenImageRefs: previous.forgottenImageRefs }
        : {}),
    }),
  ),
  discoverBrainPackageImages: vi.fn(async () => []),
  mergeBrainSavedImages: vi.fn(
    (
      image: { images?: Array<{ imageRef: string }> } | null,
      discovered: Array<{ imageRef: string }>,
    ) => [...discovered, ...(image?.images ?? [])],
  ),
}));

vi.mock("@kody-ade/brain/store", () => store);
vi.mock("@kody-ade/brain/runtime-manager", () => runtimeManager);
vi.mock("@kody-ade/brain/image-runtime", () => runtime);
vi.mock("@kody-ade/brain/image-catalog", () => catalog);
vi.mock("@kody-ade/brain/service-resolver", () => serviceResolver);
vi.mock("@kody-ade/fly/plugin/runners/brain", () => ({
  brainAppName: (account: string) => `kody-brain-${account}`,
  provisionBrain: brainFly.provisionBrain,
  waitForBrainHealth: brainFly.waitForBrainHealth,
}));
vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { applyBrainImageToRuntime } from "@kody-ade/brain/image-apply";

describe("applyBrainImageToRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.readBrainApp.mockResolvedValue(null);
    store.readBrainImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    brainFly.provisionBrain.mockResolvedValue({
      app: "kody-brain-octocat",
      url: "https://kody-brain-octocat.fly.dev",
      apiKey: "brain-key",
      machineId: "machine-new",
      region: "fra",
      org: "personal",
    });
    serviceResolver.resolveBrainService.mockResolvedValue({
      app: "kody-brain-octocat",
      orgSlug: "personal",
      defaultRegion: "fra",
      flyToken: "fly-token",
      stored: null,
      state: "running",
      url: "https://kody-brain-octocat.fly.dev",
      machineId: "machine-old",
    });
    store.markBrainImageRunning.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [],
    });
    store.selectBrainImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningApp: "kody-brain-octocat",
      runningMachineId: "machine-new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [],
    });
    store.writeBrainApp.mockResolvedValue(undefined);
    store.writeBrainImage.mockResolvedValue(undefined);
    runtimeManager.resumeBrainRuntimeApply.mockResolvedValue({
      operation: { id: "apply-1", status: "running" },
    });
  });

  it("requires the image to run instead of falling back to a selected image", async () => {
    await expect(
      applyBrainImageToRuntime({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "gh-token",
        allSecrets: {},
        flyToken: "fly-token",
        flyOrgSlug: "personal",
        flyDefaultRegion: "fra",
        dashboardUrl: "https://dash.test",
      }),
    ).rejects.toThrow("Image ref is required");
  });

  it("applies the requested image and records it as running", async () => {
    const result = await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fly-token",
        account: "octocat",
        appNameOverride: "kody-brain-octocat",
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      }),
    );
    const provisionInput = brainFly.provisionBrain.mock.calls[0]?.[0] as {
      prepareRuntimeImage: (input: {
        app: string;
        sourceImageRef: string;
        runtimeImageRef: string;
      }) => Promise<void>;
    };
    await provisionInput.prepareRuntimeImage({
      app: "kody-brain-octocat",
      sourceImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runtimeImageRef: "registry.fly.io/kody-brain-octocat:selected",
    });
    expect(runtime.prepareBrainRuntimeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        runtimeImageRef: "registry.fly.io/kody-brain-octocat:selected",
        flyToken: "fly-token",
        ghcrToken: "ghcr-token",
      }),
    );
    expect(runtimeManager.beginBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:selected",
    );
    expect(runtimeManager.setBrainRuntimeApplyStage).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "apply-1",
      "ghcr.io/acme/kody-brain-octocat:selected",
      "verifying-health",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
    expect(runtimeManager.completeBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        app: "kody-brain-octocat",
        machineId: "machine-new",
        orgSlug: "personal",
      }),
    );
    expect(brainFly.waitForBrainHealth).toHaveBeenCalledWith(
      "https://kody-brain-octocat.fly.dev",
      300_000,
    );
    expect(
      brainFly.waitForBrainHealth.mock.invocationCallOrder[0],
    ).toBeLessThan(
      runtimeManager.completeBrainRuntimeApply.mock.invocationCallOrder[0]!,
    );
    expect(result.runtime.running?.imageRef).toBe(
      "ghcr.io/acme/kody-brain-octocat:selected",
    );
  });

  it("resumes the durable operation when the restore queue retries", async () => {
    await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      operationId: "apply-1",
    });

    expect(runtimeManager.resumeBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "apply-1",
      "ghcr.io/acme/kody-brain-octocat:selected",
    );
    expect(runtimeManager.beginBrainRuntimeApply).not.toHaveBeenCalled();
  });

  it("records image resolution failure after the operation starts", async () => {
    store.readBrainImage.mockResolvedValueOnce(null);
    catalog.discoverBrainPackageImages.mockResolvedValueOnce([]);

    await expect(
      applyBrainImageToRuntime({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "gh-token",
        allSecrets: {},
        flyToken: "fly-token",
        flyOrgSlug: "personal",
        flyDefaultRegion: "fra",
        dashboardUrl: "https://dash.test",
        imageRef: "ghcr.io/acme/kody-brain-octocat:missing",
      }),
    ).rejects.toThrow("No Brain images saved");

    expect(runtimeManager.failBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:missing",
      "No Brain images saved",
      "apply-1",
    );
  });

  it("does not record the image as running when Brain never becomes healthy", async () => {
    brainFly.waitForBrainHealth.mockRejectedValueOnce(
      new Error("Brain did not become healthy"),
    );

    await expect(
      applyBrainImageToRuntime({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "gh-token",
        allSecrets: {},
        flyToken: "fly-token",
        flyOrgSlug: "personal",
        flyDefaultRegion: "fra",
        dashboardUrl: "https://dash.test",
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      }),
    ).rejects.toThrow("Brain did not become healthy");

    expect(runtimeManager.completeBrainRuntimeApply).not.toHaveBeenCalled();
    expect(runtimeManager.failBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:selected",
      "Brain did not become healthy",
      "apply-1",
    );
  });

  it("applies an explicitly requested saved image without requiring it to be selected first", async () => {
    store.readBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:old",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:old",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-02T01:00:00.000Z",
          updatedAt: "2026-07-02T01:00:00.000Z",
        },
      ],
    });
    store.selectBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:new",
      runningApp: "kody-brain-octocat",
      runningMachineId: "machine-new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T01:00:00.000Z",
      images: [],
    });

    const result = await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      }),
    );
    expect(result.runtime.running?.imageRef).toBe(
      "ghcr.io/acme/kody-brain-octocat:new",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
  });

  it("requests machine replacement when restoring the active image", async () => {
    await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      resetExistingMachine: true,
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        replaceExistingMachine: true,
      }),
    );
  });

  it("applies a recently discovered GHCR image when the saved image record is stale", async () => {
    store.readBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:old",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:old",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    catalog.discoverBrainPackageImages.mockResolvedValueOnce([
      {
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
        createdAt: "2026-07-05T12:53:01.000Z",
        updatedAt: "2026-07-05T12:53:01.000Z",
      },
    ] as never);
    store.selectBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-05T12:53:01.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-05T12:53:01.000Z",
          updatedAt: "2026-07-05T12:53:01.000Z",
        },
      ],
    });

    await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
    });

    expect(catalog.discoverBrainPackageImages).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "ghcr-token",
      }),
    );
    expect(store.writeBrainImage).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      expect.objectContaining({
        images: expect.arrayContaining([
          expect.objectContaining({
            imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          }),
        ]),
      }),
    );
    expect(store.writeBrainImage.mock.calls[0]?.[2]).not.toHaveProperty(
      "imageRef",
      "ghcr.io/acme/kody-brain-octocat:new",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      }),
    );
  });

  it("uses the resolver-selected Fly token for stored Brain operations", async () => {
    serviceResolver.resolveBrainService.mockResolvedValueOnce({
      app: "custom-brain",
      orgSlug: "other-org",
      defaultRegion: "fra",
      flyToken: "fallback-fly-token",
      stored: {
        version: 1,
        appName: "custom-brain",
        orgSlug: "other-org",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      state: "suspended",
      url: "https://custom-brain.fly.dev",
      machineId: "machine-old",
    });

    await applyBrainImageToRuntime({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "vault-fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "custom-brain",
        orgSlug: "other-org",
      }),
    );
  });

  it("fails the apply operation when the Brain app record cannot be saved", async () => {
    store.writeBrainApp.mockRejectedValueOnce(new Error("backend down"));

    await expect(
      applyBrainImageToRuntime({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "gh-token",
        allSecrets: {},
        flyToken: "fly-token",
        flyOrgSlug: "personal",
        flyDefaultRegion: "fra",
        dashboardUrl: "https://dash.test",
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      }),
    ).rejects.toThrow("backend down");

    expect(runtimeManager.failBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:selected",
      "backend down",
      "apply-1",
    );
  });
});
