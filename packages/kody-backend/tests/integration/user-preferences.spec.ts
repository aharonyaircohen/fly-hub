import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const USER_KEY = "operator-alice-12345678";
const NOW = "2026-07-20T10:00:00.000Z";

describe("global user preferences", () => {
  it("stores one preference document per user and namespace", async () => {
    const t = setup();

    await t.mutation(api.userPreferences.save, {
      namespace: "navigation",
      userKey: USER_KEY,
      data: { favoriteHrefs: ["/tasks", "/reports"] },
      updatedAt: NOW,
    });

    await expect(
      t.query(api.userPreferences.get, {
        namespace: "navigation",
        userKey: USER_KEY,
      }),
    ).resolves.toMatchObject({
      data: { favoriteHrefs: ["/tasks", "/reports"] },
      updatedAt: NOW,
    });
  });

  it("updates the existing preference document instead of duplicating it", async () => {
    const t = setup();

    await t.mutation(api.userPreferences.save, {
      namespace: "navigation",
      userKey: USER_KEY,
      data: { favoriteHrefs: ["/tasks"] },
      updatedAt: NOW,
    });
    await t.mutation(api.userPreferences.save, {
      namespace: "navigation",
      userKey: USER_KEY,
      data: { favoriteHrefs: ["/tasks", "/preview"] },
      updatedAt: "2026-07-20T10:01:00.000Z",
    });

    await expect(
      t.query(api.userPreferences.get, {
        namespace: "navigation",
        userKey: USER_KEY,
      }),
    ).resolves.toMatchObject({
      data: { favoriteHrefs: ["/tasks", "/preview"] },
      updatedAt: "2026-07-20T10:01:00.000Z",
    });
  });
});
