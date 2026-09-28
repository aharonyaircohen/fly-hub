import { describe, expect, it } from "vitest";

import { sessionRequestError } from "../../../src/dashboard/lib/chat/plugins/terminal/use-terminal-session";

describe("terminal session request recovery", () => {
  it("automatically retries while a Brain machine is still waking", () => {
    expect(
      sessionRequestError({
        code: "machine_not_running",
        message: "Brain machine did not become ready in time.",
        status: 409,
      }).retryable,
    ).toBe(true);
  });
});
