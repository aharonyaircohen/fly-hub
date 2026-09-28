import { afterEach, describe, expect, it } from "vitest";
import {
  deriveAppLaunchKey,
  mintAppLaunchTicket,
  verifyAppLaunchTicket,
} from "../../src/apps/access-ticket";
describe("App launch tickets", () => {
  afterEach(() => delete process.env.KODY_MASTER_KEY);
  it("binds a short-lived ticket to one repository App", () => {
    process.env.KODY_MASTER_KEY = "11".repeat(32);
    const { ticket, expiresAt } = mintAppLaunchTicket("acme/web", "app-1", 60);
    expect(
      verifyAppLaunchTicket(
        ticket,
        "acme/web",
        "app-1",
        deriveAppLaunchKey(),
        expiresAt - 1,
      ),
    ).toBe(true);
    expect(
      verifyAppLaunchTicket(
        ticket,
        "other/web",
        "app-1",
        deriveAppLaunchKey(),
        expiresAt - 1,
      ),
    ).toBe(false);
    expect(
      verifyAppLaunchTicket(
        ticket,
        "acme/web",
        "app-1",
        deriveAppLaunchKey(),
        expiresAt,
      ),
    ).toBe(false);
  });
});
