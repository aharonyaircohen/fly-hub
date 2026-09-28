import { describe, expect, it } from "vitest";

import { emailPasswordOptions } from "../../convex/betterAuth/auth";
import { resetQaPassword } from "../../convex/qaUserProvisioning";

describe("QA user provisioning", () => {
  it("keeps public email registration disabled", () => {
    expect(emailPasswordOptions()).toMatchObject({
      enabled: true,
      disableSignUp: true,
    });
  });

  it("allows signup only for the trusted provisioning action", () => {
    expect(emailPasswordOptions({ allowSignUp: true })).toMatchObject({
      enabled: true,
      disableSignUp: false,
    });
  });

  it("replaces the QA password with a hash from the active runtime", async () => {
    const calls: string[][] = [];
    await resetQaPassword(
      {
        internalAdapter: {
          findUserByEmail: async (email) => {
            calls.push(["find", email]);
            return { user: { id: "qa-user" } };
          },
          updatePassword: async (userId, hash) => {
            calls.push(["update", userId, hash]);
          },
        },
        password: {
          hash: async (password) => {
            calls.push(["hash", password]);
            return "http-runtime-hash";
          },
        },
      },
      "qa@kody.test",
      "stored-password",
    );
    expect(calls).toEqual([
      ["find", "qa@kody.test"],
      ["hash", "stored-password"],
      ["update", "qa-user", "http-runtime-hash"],
    ]);
  });
});
