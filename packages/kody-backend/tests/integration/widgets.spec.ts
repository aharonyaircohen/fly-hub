import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-07-21T00:00:00.000Z";

describe("widgets", () => {
  it("publishes versions atomically and serves the latest", async () => {
    const t = setup();
    const base = {
      tenantId: TENANT,
      name: "Exercise Player",
      slug: "exercise-player",
      bundle: "export default {}",
      updatedAt: NOW,
    };
    expect(await t.mutation(api.widgets.publish, base)).toBe(1);
    expect(
      await t.mutation(api.widgets.publish, {
        ...base,
        bundle: "export default {v:2}",
        commitSha: "abc123",
      }),
    ).toBe(2);

    const latest = await t.query(api.widgets.latest, {
      tenantId: TENANT,
      slug: "exercise-player",
    });
    expect(latest).toMatchObject({
      name: "Exercise Player",
      version: 2,
      bundle: "export default {v:2}",
      commitSha: "abc123",
    });
    expect(
      await t.query(api.widgets.latest, {
        tenantId: "other/tenant",
        slug: "exercise-player",
      }),
    ).toBeNull();

    const listed = await t.query(api.widgets.list, { tenantId: TENANT });
    expect(listed).toEqual([
      expect.objectContaining({
        name: "Exercise Player",
        slug: "exercise-player",
        version: 2,
      }),
    ]);
  });
});
