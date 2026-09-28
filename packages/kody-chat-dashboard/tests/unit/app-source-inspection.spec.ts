import { describe, expect, it } from "vitest";
import { normalizeSingleMachineRuntimeEnvironment } from "../../src/dashboard/lib/apps/source-inspection";

describe("normalizeSingleMachineRuntimeEnvironment", () => {
  it("points compose service URLs at the bundled local service", () => {
    expect(
      normalizeSingleMachineRuntimeEnvironment(
        { SURREAL_URL: "ws://surrealdb:8000/rpc", SURREAL_USER: "root" },
        "services:\n  surrealdb:\n    image: surrealdb/surrealdb\n",
        "single",
      ),
    ).toEqual({
      SURREAL_URL: "ws://127.0.0.1:8000/rpc",
      SURREAL_USER: "root",
    });
  });
});
