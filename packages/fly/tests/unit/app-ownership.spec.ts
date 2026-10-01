import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertFlyHubAppOwned } from "../../src/hub/app-ownership";
import { startSavedAppJob } from "../../src/hub/saved-apps";
import {
  listAppsByPrefix,
  listMachines,
} from "../../src/plugin/previews/machines-client";
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listAppsByPrefix: vi.fn(),
  listMachines: vi.fn(),
}));
const cfg = {
  token: "multi-org-token",
  orgSlug: "selected-org",
  defaultRegion: "iad",
};
const app = "flyhub-app-outside-123456789abc";
beforeEach(() => vi.clearAllMocks());
describe("FlyHub organization boundary", () => {
  it("rejects an accessible app outside the selected organization", async () => {
    vi.mocked(listAppsByPrefix).mockResolvedValue([]);
    await expect(assertFlyHubAppOwned(app, cfg)).rejects.toMatchObject({
      status: 404,
    });
    expect(listAppsByPrefix).toHaveBeenCalledWith("flyhub-app-", cfg);
  });
  it("rejects a save before inspecting machines or contacting GitHub", async () => {
    vi.stubEnv("FLY_HUB_BUILDER_IMAGE", "builder-image");
    vi.mocked(listAppsByPrefix).mockResolvedValue([]);
    try {
      await expect(
        startSavedAppJob(
          cfg,
          { user: "owner", token: "github-secret" },
          { action: "save", app },
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(listMachines).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
