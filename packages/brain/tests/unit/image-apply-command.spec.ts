import { describe, expect, it, vi } from "vitest";
import { applyBrainImage } from "../../src/image-apply-command";
import type { PersonalBrainContext } from "../../src/personal-context";

const apply = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("../../src/image-apply", () => ({ applyBrainImageToRuntime: apply }));

describe("personal image restore ownership", () => {
  it("keeps Kody ownership separate from the verified GitHub registry account", async () => {
    const context = {
      account: "user-123",
      githubAccount: "github-login",
      githubOwner: "github-login",
      flyToken: "test-fly",
      githubToken: "test-pat",
      allSecrets: {},
    } as PersonalBrainContext;
    await applyBrainImage({
      context,
      dashboardUrl: "https://dashboard.test",
      imageRef: "ghcr.io/github-login/brain:saved",
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "user-123",
        githubAccount: "github-login",
        githubToken: "test-pat",
      }),
    );
  });

  it("uses the verified GitHub account when no explicit owner is stored", async () => {
    const context = {
      account: "user-123",
      githubAccount: "github-login",
      flyToken: "test-fly",
      githubToken: "test-pat",
      allSecrets: {},
    } as PersonalBrainContext;
    await applyBrainImage({
      context,
      dashboardUrl: "https://dashboard.test",
      imageRef: "ghcr.io/github-login/brain:saved",
    });
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ owner: "github-login" }),
    );
  });
});
