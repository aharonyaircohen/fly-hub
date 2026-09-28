import { describe, expect, it } from "vitest";
import { planAppRuntimeSecrets } from "../../src/dashboard/lib/apps/runtime-configuration";

describe("planAppRuntimeSecrets", () => {
  it("generates app-owned keys without asking the user for them", () => {
    const result = planAppRuntimeSecrets({
      requestedNames: [],
      generatedNames: ["OPEN_NOTEBOOK_ENCRYPTION_KEY"],
      vaultValues: {},
      generateValue: () => "generated-key",
    });

    expect(result).toEqual({
      missingNames: [],
      generatedValues: { OPEN_NOTEBOOK_ENCRYPTION_KEY: "generated-key" },
      secretNames: ["OPEN_NOTEBOOK_ENCRYPTION_KEY"],
    });
  });

  it("still blocks values that the app owner must provide", () => {
    const result = planAppRuntimeSecrets({
      requestedNames: ["EXTERNAL_API_TOKEN"],
      generatedNames: ["INTERNAL_ENCRYPTION_KEY"],
      vaultValues: { INTERNAL_ENCRYPTION_KEY: "existing-key" },
      generateValue: () => "unused",
    });

    expect(result.missingNames).toEqual(["EXTERNAL_API_TOKEN"]);
    expect(result.generatedValues).toEqual({});
  });
});
