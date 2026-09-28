import { describe, expect, it } from "vitest";

import { executeJourneyRun } from "../../../src/dashboard/lib/user-journeys/worker";
import type { JourneyDefinition } from "../../../src/dashboard/lib/user-journeys/contracts";
import type { JourneyBrowserPage } from "../../../src/dashboard/lib/user-journeys/runner";

const definition: JourneyDefinition = {
  id: "journey",
  name: "Journey",
  goal: "Goal",
  status: "active",
  priority: "normal",
  scenarios: [{
    id: "happy",
    name: "Happy",
    kind: "happy",
    steps: [{
      id: "open",
      action: { type: "navigate", url: "/" },
      assertions: [{ type: "visible", locator: { by: "role", role: "heading", name: "Home" } }],
    }],
  }],
};

const page = {
  goto: async () => undefined,
  reload: async () => undefined,
  getByRole: () => ({ click: async () => undefined, fill: async () => undefined, selectOption: async () => undefined, check: async () => undefined, uncheck: async () => undefined, isVisible: async () => true, isHidden: async () => false, innerText: async () => "", isEnabled: async () => true }),
  getByLabel: () => ({ click: async () => undefined, fill: async () => undefined, selectOption: async () => undefined, check: async () => undefined, uncheck: async () => undefined, isVisible: async () => true, isHidden: async () => false, innerText: async () => "", isEnabled: async () => true }),
  getByText: () => ({ click: async () => undefined, fill: async () => undefined, selectOption: async () => undefined, check: async () => undefined, uncheck: async () => undefined, isVisible: async () => true, isHidden: async () => false, innerText: async () => "", isEnabled: async () => true }),
  getByTestId: () => ({ click: async () => undefined, fill: async () => undefined, selectOption: async () => undefined, check: async () => undefined, uncheck: async () => undefined, isVisible: async () => true, isHidden: async () => false, innerText: async () => "", isEnabled: async () => true }),
  url: () => "http://localhost/",
} satisfies JourneyBrowserPage;

describe("user journey worker", () => {
  it("persists lifecycle and step evidence for a passing run", async () => {
    const updates: Array<{ status: string }> = [];
    const events: unknown[] = [];
    const result = await executeJourneyRun({
      tenantId: "acme/app",
      runId: "run-1",
      definition,
      page,
      now: () => "2026-07-19T00:00:00.000Z",
      store: {
        updateRun: async (input) => { updates.push(input); },
        appendRunEvent: async (input) => { events.push(input); },
      },
    });

    expect(result.status).toBe("passed");
    expect(updates.map(({ status }) => status)).toEqual(["running", "passed"]);
    expect(events).toHaveLength(3);
  });
});
