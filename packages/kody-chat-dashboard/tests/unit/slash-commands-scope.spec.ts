import { describe, expect, it } from "vitest";
import { slashCommandsScopeKey } from "../../src/dashboard/lib/chat/plugins/commands/useSlashCommands";

describe("slash command scope", () => {
  it("loads personal commands without GitHub auth", () => {
    expect(slashCommandsScopeKey(null)).toBe("personal");
  });

  it("isolates cached commands by repository", () => {
    expect(slashCommandsScopeKey({ owner: "acme", repo: "app" } as never)).toBe(
      "acme/app",
    );
  });
});
