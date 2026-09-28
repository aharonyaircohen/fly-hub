import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("user credentials", () => {
  it("isolates encrypted credentials by user and never lists values", async () => {
    const t = setup();
    await t.mutation(api.userCredentials.upsert, {
      userKey: "user-a",
      name: "MINIMAX_API_KEY",
      encryptedValue: "encrypted-a",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    await t.mutation(api.userCredentials.upsert, {
      userKey: "user-b",
      name: "MINIMAX_API_KEY",
      encryptedValue: "encrypted-b",
      updatedAt: "2026-08-17T00:01:00.000Z",
    });

    await expect(
      t.query(api.userCredentials.list, { userKey: "user-a" }),
    ).resolves.toEqual([
      {
        name: "MINIMAX_API_KEY",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    ]);
    await expect(
      t.query(api.userCredentials.get, {
        userKey: "user-a",
        name: "MINIMAX_API_KEY",
      }),
    ).resolves.toMatchObject({ encryptedValue: "encrypted-a" });
  });

  it("updates and removes only the selected user's credential", async () => {
    const t = setup();
    await t.mutation(api.userCredentials.upsert, {
      userKey: "user-a",
      name: "OPENROUTER_API_KEY",
      encryptedValue: "first",
      updatedAt: "first",
    });
    await t.mutation(api.userCredentials.upsert, {
      userKey: "user-a",
      name: "OPENROUTER_API_KEY",
      encryptedValue: "second",
      updatedAt: "second",
    });

    await expect(
      t.query(api.userCredentials.get, {
        userKey: "user-a",
        name: "OPENROUTER_API_KEY",
      }),
    ).resolves.toMatchObject({ encryptedValue: "second", updatedAt: "second" });

    await t.mutation(api.userCredentials.remove, {
      userKey: "user-a",
      name: "OPENROUTER_API_KEY",
    });
    await expect(
      t.query(api.userCredentials.get, {
        userKey: "user-a",
        name: "OPENROUTER_API_KEY",
      }),
    ).resolves.toBeNull();
  });
});
