import { describe, expect, it } from "vitest";

import type { AgentFile } from "../src/agent-files";
import {
  mergeResolvedAgentFiles,
  readResolvedAgentFromSources,
} from "../src/agent-files";
import { listBuiltinAgentFiles } from "../src/builtin-agents";

const agent = (slug: string, source: "local" | "store"): AgentFile => ({
  slug,
  title: `${source} ${slug}`,
  body: "test",
  sha: "",
  updatedAt: "2026-08-08T00:00:00.000Z",
  htmlUrl: "",
  source,
  readOnly: source === "store",
});

describe("built-in Agent resolution", () => {
  it("keeps built-in definitions immutable and merges configured additions", () => {
    const result = mergeResolvedAgentFiles({
      local: [
        {
          ...agent("kody", "local"),
          subagents: ["custom-specialist"],
          primaryIntent: "operate-agency",
        },
        {
          ...agent("agency-specialist", "local"),
          capabilities: ["agency-management"],
          subagents: ["custom-agency-helper"],
        },
        agent("local-only", "local"),
      ],
      builtin: listBuiltinAgentFiles(),
      store: [agent("kody", "store"), agent("store-only", "store")],
    });

    const kody = result.find(({ slug }) => slug === "kody");
    expect(kody?.source).toBe("builtin");
    expect(kody?.subagents).toEqual([
      ...kody!.lockedSubagents!,
      "custom-specialist",
    ]);
    expect(kody?.primaryIntent).toBe("operate-agency");
    const agency = result.find(({ slug }) => slug === "agency-specialist");
    expect(agency?.source).toBe("builtin");
    expect(agency?.capabilities).toEqual([
      "builtin-agent-agency-specialist",
      "agency-management",
    ]);
    expect(agency?.subagents).toEqual(["custom-agency-helper"]);
    expect(result.map(({ slug }) => slug)).not.toContain("agency-architect");
    expect(result.find(({ slug }) => slug === "store-only")?.source).toBe(
      "store",
    );
    expect(result.map(({ slug }) => slug)).not.toContain("kody-store-copy");
  });

  it("resolves built-ins before local and Store definitions", () => {
    const builtin = listBuiltinAgentFiles();

    expect(
      readResolvedAgentFromSources("kody", [agent("kody", "local")], builtin, [
        agent("kody", "store"),
      ])?.source,
    ).toBe("builtin");
    expect(
      readResolvedAgentFromSources("kody", [], builtin, [
        agent("kody", "store"),
      ])?.source,
    ).toBe("builtin");
    expect(
      readResolvedAgentFromSources("store-only", [], builtin, [
        agent("store-only", "store"),
      ])?.source,
    ).toBe("store");
  });

  it("does not let a legacy Store-sourced backend row override a built-in", () => {
    const result = mergeResolvedAgentFiles({
      local: [agent("kody", "store")],
      builtin: listBuiltinAgentFiles(),
      store: [],
    });

    expect(result.find(({ slug }) => slug === "kody")?.source).toBe("builtin");
  });
});
