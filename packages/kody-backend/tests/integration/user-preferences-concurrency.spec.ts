import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("personal runtime concurrency", () => {
  it("rejects stale state updates and competing initial operations", async () => {
    const t = setup();
    const key = { namespace: "brain:runtime", userKey: "user-a" };
    await t.mutation(api.userPreferences.save, {
      ...key,
      data: { updatedAt: "one", operation: { id: "a" } },
      updatedAt: "one",
      expectedDataUpdatedAt: null,
    });
    await expect(
      t.mutation(api.userPreferences.save, {
        ...key,
        data: { updatedAt: "two" },
        updatedAt: "two",
        expectedDataUpdatedAt: null,
      }),
    ).rejects.toThrow();
    await t.mutation(api.userPreferences.save, {
      ...key,
      data: { updatedAt: "two", operation: { id: "b" } },
      updatedAt: "two",
      expectedDataUpdatedAt: "one",
    });
    await expect(
      t.mutation(api.userPreferences.save, {
        ...key,
        data: { updatedAt: "three" },
        updatedAt: "three",
        expectedDataUpdatedAt: "one",
      }),
    ).rejects.toThrow();
    expect(
      (await t.query(api.userPreferences.get, key))?.data.operation.id,
    ).toBe("b");
  });
});
