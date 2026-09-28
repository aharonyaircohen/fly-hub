/** @fileoverview Kody keeps immutable identity with configurable assignments. */
import { describe, expect, it } from "vitest";
import { agentUiPermissions } from "@dashboard/lib/agent-ui-policy";

describe("Kody agent editability", () => {
  it("allows Kody's assignments without allowing identity edits or deletion", () => {
    expect(agentUiPermissions({ slug: "kody", source: "builtin" })).toEqual({
      isCodeOwned: true,
      canConfigureIdentity: false,
      canConfigureSubagents: true,
      canDelete: false,
    });
  });

  it("keeps repository Agents fully configurable", () => {
    expect(
      agentUiPermissions({ slug: "release-agent", source: "local" }),
    ).toEqual({
      isCodeOwned: false,
      canConfigureIdentity: true,
      canConfigureSubagents: true,
      canDelete: true,
    });
  });
});
