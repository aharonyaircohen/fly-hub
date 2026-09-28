import { describe, expect, it } from "vitest";

import type { KodyAuth } from "../../src/dashboard/lib/auth-context";
import { guidedFlowRequestAuth } from "../../src/dashboard/lib/guided-flows/page-scope";

const auth = {
  owner: "acme",
  repo: "app",
} as KodyAuth;

describe("Guided Flow page scope", () => {
  it("does not send repository credentials from the personal page", () => {
    expect(guidedFlowRequestAuth("/guided-flows", auth)).toBeNull();
  });

  it("uses repository credentials from a repository page", () => {
    expect(
      guidedFlowRequestAuth("/repo/acme/app/guided-flows", auth),
    ).toBe(auth);
  });
});
