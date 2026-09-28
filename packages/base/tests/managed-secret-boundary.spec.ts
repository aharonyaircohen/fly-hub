import { describe, expect, it } from "vitest";

import { MANAGED_BACKGROUND_GITHUB_TOKEN } from "../src/auth/background-token-contract";
import { listSecretMetadata } from "../src/vault/store";

describe("managed secret boundary", () => {
  it("does not expose retired managed credential metadata as a user secret", () => {
    expect(
      listSecretMetadata({
        version: 1,
        secrets: {
          USER_SECRET: { value: "user", updatedAt: "now" },
          [MANAGED_BACKGROUND_GITHUB_TOKEN]: {
            value: "managed",
            updatedAt: "now",
          },
        },
      }),
    ).toEqual([{ name: "USER_SECRET", updatedAt: "now" }]);
  });
});
