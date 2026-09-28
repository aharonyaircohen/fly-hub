import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getInstallationToken: vi.fn(),
  isConfigured: vi.fn(),
  writeCredential: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("../src/auth/app-token", () => ({
  getInstallationToken: dependencies.getInstallationToken,
}));

vi.mock("../src/auth/background-credential-store", () => ({
  isBackgroundCredentialStoreConfigured: dependencies.isConfigured,
  writeManagedBackgroundCredential: dependencies.writeCredential,
  deleteManagedBackgroundCredential: dependencies.deleteCredential,
}));

import { provisionBackgroundGitHubAccess } from "../src/auth/background-token-provisioning";

describe("managed background GitHub access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getInstallationToken.mockResolvedValue(null);
    dependencies.isConfigured.mockReturnValue(true);
    dependencies.writeCredential.mockResolvedValue(undefined);
    dependencies.deleteCredential.mockResolvedValue(undefined);
  });

  it("uses the GitHub App without retaining a human PAT", async () => {
    dependencies.getInstallationToken.mockResolvedValue("installation-token");

    const result = await provisionBackgroundGitHubAccess({
      owner: "acme",
      repo: "widgets",
      token: "github_pat_verified",
      actorLogin: "alice",
    });

    expect(result).toEqual({ ok: true, source: "github-app" });
    expect(dependencies.deleteCredential).toHaveBeenCalledWith(
      "acme",
      "widgets",
    );
    expect(dependencies.writeCredential).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("github_pat_verified");
  });

  it("stores an encrypted PAT only when the App is unavailable", async () => {
    const result = await provisionBackgroundGitHubAccess({
      owner: "acme",
      repo: "widgets",
      token: "github_pat_verified",
      actorLogin: "alice",
      now: "2026-08-07T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, source: "encrypted-pat" });
    expect(dependencies.writeCredential).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      token: "github_pat_verified",
      actorLogin: "alice",
      updatedAt: "2026-08-07T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("github_pat_verified");
  });

  it("fails closed when encrypted credential storage is unavailable", async () => {
    dependencies.isConfigured.mockReturnValue(false);

    await expect(
      provisionBackgroundGitHubAccess({
        owner: "acme",
        repo: "widgets",
        token: "github_pat_verified",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "credential-store-not-configured",
    });
    expect(dependencies.writeCredential).not.toHaveBeenCalled();
  });
});
