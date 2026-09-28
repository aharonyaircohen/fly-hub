import { describe, expect, it } from "vitest";

import {
  BUILTIN_GUIDED_FLOW_DEFINITIONS,
  BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS,
} from "../../src/dashboard/lib/guided-flows/builtins";
import { buildGuidedFlowFromRequestBlueprint } from "../../src/dashboard/lib/request-blueprints";

describe("built-in Request Blueprints", () => {
  it("generates only request-driven Guided Flows", () => {
    const generated = BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS.map((blueprint) =>
      buildGuidedFlowFromRequestBlueprint(blueprint),
    );

    expect(generated).toHaveLength(4);
    expect(BUILTIN_GUIDED_FLOW_DEFINITIONS).toEqual(
      expect.arrayContaining(generated),
    );
    expect(
      BUILTIN_GUIDED_FLOW_DEFINITIONS.filter((flow) => flow.source),
    ).toEqual(generated);
    expect(
      BUILTIN_GUIDED_FLOW_DEFINITIONS.some(
        (flow) => flow.id === "onboarding" && !flow.source,
      ),
    ).toBe(true);
  });

  it("preserves versioned definitions as separate generated flows", () => {
    const identities = BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS.map(
      ({ id, version }) => `${id}@${version}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
  });
});
