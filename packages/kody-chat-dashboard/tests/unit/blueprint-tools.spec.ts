import { describe, expect, it, vi } from "vitest";
import { createBlueprintTools } from "../../app/api/kody/chat/tools/blueprint-tools";

describe("Blueprint status tool", () => {
  it("returns repository Blueprint status without using workflow inventory", async () => {
    const getBlueprintStatus = vi.fn().mockResolvedValue({
      blueprints: [{ id: "healthy-ci", status: "not_installed" }],
    });
    const tools = createBlueprintTools({ getBlueprintStatus });

    await expect(
      tools.get_blueprint_status.execute?.({}, {} as never),
    ).resolves.toEqual({
      blueprints: [{ id: "healthy-ci", status: "not_installed" }],
    });
    expect(getBlueprintStatus).toHaveBeenCalledOnce();
  });
});
