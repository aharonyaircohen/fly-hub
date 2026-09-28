import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePreviewConfigForRepo: vi.fn(),
  resolveBackgroundToken: vi.fn(),
  resolveVaultGithubToken: vi.fn(),
  compareCommitsWithBasehead: vi.fn(),
  createPreview: vi.fn(),
  rebuildBaseImage: vi.fn(),
  readDashboardConfig: vi.fn(),
  routePreviewBuild: vi.fn(),
  sweepExpiredPreviews: vi.fn(),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      repos: {
        compareCommitsWithBasehead: mocks.compareCommitsWithBasehead,
      },
    };
  }),
}));
vi.mock("@kody-ade/fly/previews/config", () => ({
  resolvePreviewConfigForRepo: mocks.resolvePreviewConfigForRepo,
}));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: mocks.resolveBackgroundToken,
}));
vi.mock("@kody-ade/base/vault/bootstrap", () => ({
  resolveVaultGithubToken: mocks.resolveVaultGithubToken,
}));
vi.mock("@kody-ade/fly/previews/base-rebuild", () => ({
  rebuildBaseImage: mocks.rebuildBaseImage,
}));
vi.mock("@kody-ade/fly/previews/preview-router", () => ({
  routePreviewBuild: mocks.routePreviewBuild,
}));
vi.mock("@kody-ade/fly/previews/preview-lifecycle", () => ({
  createPreview: mocks.createPreview,
  destroyPreview: vi.fn(),
}));
vi.mock("@kody-ade/fly/previews/sweep", () => ({
  sweepExpiredPreviews: mocks.sweepExpiredPreviews,
}));
// Tracked-branch list is host-injected into @kody-ade/fly (see
// tracked-branches-hook); the test wires the mock reader below.
vi.mock("@kody-ade/fly/plugin/runners/inventory", () => ({
  listFlyInventory: vi.fn(),
}));
vi.mock("@kody-ade/fly/plugin/runners/activity-store", () => ({
  readActivityFile: vi.fn(),
  recordSnapshot: vi.fn(),
  snapshotDue: vi.fn(() => false),
  snapshotFromInventory: vi.fn(),
}));

import { setTrackedBranchesReader } from "@kody-ade/fly/previews/tracked-branches-hook";

setTrackedBranchesReader(async (octokit, owner, repo) => {
  const { doc } = await mocks.readDashboardConfig(octokit, owner, repo, {
    force: true,
  });
  return (doc.branchPreviews ?? []) as string[];
});

import {
  handleDefaultBranchPush,
  handlePrOpenedOrSynced,
  handleTrackedBranchPush,
} from "@kody-ade/fly/previews/webhook";

describe("preview webhook maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePreviewConfigForRepo.mockResolvedValue({
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });
    mocks.resolveBackgroundToken.mockResolvedValue(null);
    mocks.resolveVaultGithubToken.mockResolvedValue(null);
    mocks.compareCommitsWithBasehead.mockResolvedValue({
      data: { files: [{ filename: "src/app.tsx" }] },
    });
    mocks.rebuildBaseImage.mockResolvedValue(undefined);
    mocks.routePreviewBuild.mockResolvedValue({
      runner: "fly",
      reason: "fly preferred",
      flyUrl: "https://kp.fly.dev",
    });
    mocks.createPreview.mockResolvedValue({
      url: "https://branch.fly.dev",
      appName: "branch-app",
      machineId: "machine-1",
      state: "starting",
      region: "fra",
      builderMachineId: "builder-1",
    });
    mocks.readDashboardConfig.mockResolvedValue({
      doc: { version: 1, branchPreviews: ["dev"] },
      sha: "config-sha",
    });
    mocks.sweepExpiredPreviews.mockResolvedValue({
      enabled: true,
      ttlDays: 14,
      inspected: 0,
      destroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      slept: [],
      errored: [],
    });
  });

  it("still sweeps expired previews when the router path handles the build", async () => {
    await handlePrOpenedOrSynced({
      repoFullName: "acme/widgets",
      prNumber: 7,
      ref: "abc1234",
    });

    expect(mocks.routePreviewBuild).toHaveBeenCalledOnce();
    expect(mocks.sweepExpiredPreviews).toHaveBeenCalledWith("acme/widgets");
  });

  it("routes PR branch updates to a fresh preview build at the new head SHA", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "github-token" });

    await handlePrOpenedOrSynced({
      repoFullName: "acme/widgets",
      prNumber: 7,
      ref: "new-head-sha",
      beforeSha: "old-head-sha",
    });

    expect(mocks.compareCommitsWithBasehead).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      basehead: "old-head-sha...new-head-sha",
    });
    expect(mocks.routePreviewBuild).toHaveBeenCalledWith({
      repoFullName: "acme/widgets",
      prNumber: 7,
      ref: "new-head-sha",
    });
  });

  it("skips the rebuild when a PR branch update only touches release bookkeeping", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "github-token" });
    mocks.compareCommitsWithBasehead.mockResolvedValue({
      data: { files: [{ filename: "CHANGELOG.md" }] },
    });

    await handlePrOpenedOrSynced({
      repoFullName: "acme/widgets",
      prNumber: 7,
      ref: "new-head-sha",
      beforeSha: "old-head-sha",
    });

    expect(mocks.routePreviewBuild).not.toHaveBeenCalled();
    expect(mocks.sweepExpiredPreviews).not.toHaveBeenCalled();
  });

  it("rebuilds a tracked branch preview when that branch receives a push", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "github-token" });

    await handleTrackedBranchPush({
      repoFullName: "acme/widgets",
      branch: "dev",
      ref: "new-head-sha",
      changedPaths: ["src/app.tsx"],
    });

    expect(mocks.readDashboardConfig).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      { force: true },
    );
    expect(mocks.createPreview).toHaveBeenCalledWith(
      {
        repo: "acme/widgets",
        branch: "dev",
        ref: "new-head-sha",
        githubToken: "github-token",
      },
      expect.objectContaining({ token: "fly-token" }),
    );
    expect(mocks.sweepExpiredPreviews).toHaveBeenCalledWith("acme/widgets");
  });

  it("does not rebuild an untracked branch preview on push", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "github-token" });
    mocks.readDashboardConfig.mockResolvedValue({
      doc: { version: 1, branchPreviews: ["staging"] },
      sha: "config-sha",
    });

    await handleTrackedBranchPush({
      repoFullName: "acme/widgets",
      branch: "dev",
      ref: "new-head-sha",
      changedPaths: ["src/app.tsx"],
    });

    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.sweepExpiredPreviews).not.toHaveBeenCalled();
  });

  it("skips a tracked branch preview rebuild for engine-only pushes", async () => {
    await handleTrackedBranchPush({
      repoFullName: "acme/widgets",
      branch: "dev",
      ref: "new-head-sha",
      changedPaths: ["CHANGELOG.md"],
    });

    expect(mocks.resolveBackgroundToken).not.toHaveBeenCalled();
    expect(mocks.readDashboardConfig).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.sweepExpiredPreviews).not.toHaveBeenCalled();
  });

  it("uses the vault GitHub token for default-branch base image rebuilds", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "app-token" });
    mocks.resolveVaultGithubToken.mockResolvedValue("vault-token");

    await handleDefaultBranchPush({
      repoFullName: "acme/widgets",
      ref: "new-default-sha",
      changedPaths: ["src/app.tsx"],
    });

    expect(mocks.resolveVaultGithubToken).toHaveBeenCalledWith(
      "acme",
      "widgets",
    );
    expect(mocks.rebuildBaseImage).toHaveBeenCalledWith({
      repo: "acme/widgets",
      ref: "new-default-sha",
      cfg: expect.objectContaining({ token: "fly-token" }),
      githubToken: "vault-token",
    });
  });

  it("falls back to the background token when no vault token is available", async () => {
    mocks.resolveBackgroundToken.mockResolvedValue({ token: "app-token" });
    mocks.resolveVaultGithubToken.mockResolvedValue(null);

    await handleDefaultBranchPush({
      repoFullName: "acme/widgets",
      ref: "new-default-sha",
      changedPaths: ["src/app.tsx"],
    });

    expect(mocks.rebuildBaseImage).toHaveBeenCalledWith({
      repo: "acme/widgets",
      ref: "new-default-sha",
      cfg: expect.objectContaining({ token: "fly-token" }),
      githubToken: "app-token",
    });
  });
});
