import { describe, expect, it } from "vitest";

import { runnableStoreDefinitionSlugs } from "@dashboard/lib/store-installation-status";

describe("Store installation status", () => {
  it("keeps only configured definitions that exist in the execution backend", () => {
    const runnable = runnableStoreDefinitionSlugs(
      new Set(["ci-health-check", "prepare-ci-repair", "unused"]),
      [{ slug: "ci-health-check" }, { slug: "unconfigured-definition" }],
    );

    expect([...runnable]).toEqual(["ci-health-check"]);
  });

  it("reports no runnable definitions when the execution backend is empty", () => {
    const runnable = runnableStoreDefinitionSlugs(
      new Set(["prepare-ci-repair"]),
      [],
    );

    expect(runnable.size).toBe(0);
  });
});
