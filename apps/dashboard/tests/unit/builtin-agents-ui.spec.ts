/** @fileoverview Permission contract for code-owned Agent presentation. */
import { describe, expect, it } from "vitest";
import { agentUiPermissions } from "@dashboard/lib/agent-ui-policy";

describe("built-in Agents UI", () => {
  it("locks a built-in specialist's identity, assignments, and deletion", () => {
    expect(
      agentUiPermissions({
        slug: "agency-specialist",
        source: "builtin",
      }),
    ).toEqual({
      isCodeOwned: true,
      canConfigureIdentity: false,
      canConfigureSubagents: false,
      canDelete: false,
    });
  });
});
