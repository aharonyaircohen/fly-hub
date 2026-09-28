/**
 * @fileoverview Regression coverage for request-backed Fly inventory helpers.
 * @testFramework vitest
 * @domain runner
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const flyContext = vi.hoisted(() => ({
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "ghp_test",
      storeRepoUrl: undefined,
      storeRef: undefined,
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  })),
}));

const brainResolver = vi.hoisted(() => ({
  resolveBrainService: vi.fn(async () => ({
    app: "custom-brain",
    orgSlug: "personal",
    defaultRegion: "fra",
    stored: {
      version: 1,
      appName: "custom-brain",
      orgSlug: "personal",
      createdAt: "2026-06-29T00:00:00.000Z",
    },
    state: "running",
    url: "https://custom-brain.fly.dev",
    machineId: "brain-1",
    machine: {
      feature: "brain",
      app: "custom-brain",
      machineId: "brain-1",
      state: "started",
      region: "fra",
      label: "custom-brain",
      sizeLabel: "shared 2x",
    },
  })),
}));

const githubContext = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@kody-ade/fly/plugin/runners/context", () => flyContext);
vi.mock("@kody-ade/base/github/core", () => githubContext);
vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { setBrainServiceResolver } from "@kody-ade/fly/plugin/runners/brain-resolver-hook";

setBrainServiceResolver(brainResolver.resolveBrainService as never);

import {
  appendSavedBrainMachineToInventory,
  resolveSavedBrainServiceForRequest,
} from "@kody-ade/fly/plugin/runners/inventory-server";
import type { FlyInventory } from "@kody-ade/fly/plugin/runners/machine-model";

describe("appendSavedBrainMachineToInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reclassifies a generic listed app as the resolved Brain service", async () => {
    const inventory: FlyInventory = {
      running: 2,
      total: 2,
      machines: [
        {
          feature: "other",
          app: "custom-brain",
          machineId: "brain-1",
          state: "started",
          region: "fra",
          label: "custom-brain",
          sizeLabel: "shared 2x",
        },
        {
          feature: "brain",
          app: "kody-brain-octocat",
          machineId: "old-brain",
          state: "started",
          region: "fra",
          label: "kody-brain-octocat",
          sizeLabel: "shared 2x",
        },
      ],
    };

    await expect(
      appendSavedBrainMachineToInventory({} as never, inventory),
    ).resolves.toBe(true);

    expect(inventory.machines).toEqual([
      expect.objectContaining({
        feature: "brain",
        app: "custom-brain",
        machineId: "brain-1",
        orgSlug: "personal",
      }),
    ]);
  });

  it("removes stale Brain rows when the stored Brain has no machine", async () => {
    brainResolver.resolveBrainService.mockResolvedValueOnce({
      app: "custom-brain",
      orgSlug: "personal",
      defaultRegion: "fra",
      stored: {
        version: 1,
        appName: "custom-brain",
        orgSlug: "personal",
        createdAt: "2026-06-29T00:00:00.000Z",
      },
      state: "off",
    } as never);
    const inventory: FlyInventory = {
      running: 1,
      total: 1,
      machines: [
        {
          feature: "brain",
          app: "kody-brain-octocat",
          machineId: "old-brain",
          state: "started",
          region: "fra",
          label: "kody-brain-octocat",
          sizeLabel: "shared 2x",
        },
      ],
    };

    await expect(
      appendSavedBrainMachineToInventory({} as never, inventory),
    ).resolves.toBe(false);

    expect(inventory.machines).toEqual([]);
  });

  it("does not use an environment token to recover a hidden Brain row", async () => {
    vi.stubEnv("FLY_API_TOKEN", "env-fly-token");
    brainResolver.resolveBrainService.mockResolvedValueOnce({
      app: "custom-brain",
      orgSlug: "personal",
      defaultRegion: "fra",
      stored: {
        version: 1,
        appName: "custom-brain",
        orgSlug: "personal",
        createdAt: "2026-06-29T00:00:00.000Z",
      },
      state: "off",
    } as never);
    const inventory: FlyInventory = {
      running: 1,
      total: 1,
      machines: [
        {
          feature: "runner",
          app: "kody-runner",
          machineId: "runner-1",
          state: "started",
          region: "fra",
          label: "kody-runner",
          sizeLabel: "shared 2x",
        },
      ],
    };

    await expect(
      appendSavedBrainMachineToInventory({} as never, inventory),
    ).resolves.toBe(false);

    expect(brainResolver.resolveBrainService).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ flyToken: "fly-token" }),
    );
    expect(brainResolver.resolveBrainService).toHaveBeenCalledTimes(1);
    expect(inventory.machines).toEqual([
      expect.objectContaining({ app: "kody-runner", feature: "runner" }),
    ]);
  });

  it("returns only the repo token used to resolve the saved Brain machine", async () => {
    vi.stubEnv("FLY_API_TOKEN", "env-fly-token");
    brainResolver.resolveBrainService.mockResolvedValueOnce({
      app: "custom-brain",
      orgSlug: "personal",
      defaultRegion: "fra",
      stored: {
        version: 1,
        appName: "custom-brain",
        orgSlug: "personal",
        createdAt: "2026-06-29T00:00:00.000Z",
      },
      state: "suspended",
      machineId: "brain-1",
      machine: {
        feature: "brain",
        app: "custom-brain",
        machineId: "brain-1",
        state: "suspended",
        region: "fra",
        label: "custom-brain",
        sizeLabel: "shared 2x",
      },
    } as never);

    await expect(resolveSavedBrainServiceForRequest({} as never)).resolves
      .toMatchObject({
        flyToken: "fly-token",
        brain: {
          app: "custom-brain",
          machineId: "brain-1",
        },
      });
    expect(brainResolver.resolveBrainService).toHaveBeenCalledTimes(1);
  });
});
