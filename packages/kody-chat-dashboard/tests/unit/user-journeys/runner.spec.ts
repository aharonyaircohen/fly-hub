import { describe, expect, it } from "vitest";

import { runJourneyScenario } from "../../../src/dashboard/lib/user-journeys/runner";
import type { JourneyScenario } from "../../../src/dashboard/lib/user-journeys/contracts";

function fakePage() {
  const calls: string[] = [];
  const locator = (name: string) => ({
    async click() { calls.push(`click:${name}`); },
    async fill(value: string) { calls.push(`fill:${name}:${value}`); },
    async selectOption(value: string) { calls.push(`select:${name}:${value}`); },
    async check() { calls.push(`check:${name}`); },
    async uncheck() { calls.push(`uncheck:${name}`); },
    async isVisible() { return true; },
    async isHidden() { return false; },
    async innerText() { return "Workflow created"; },
    async isEnabled() { return true; },
  });
  return {
    calls,
    page: {
      async goto(url: string) { calls.push(`goto:${url}`); },
      async reload() { calls.push("reload"); },
      getByRole(role: string, options?: { name?: string }) { return locator(`${role}:${options?.name ?? ""}`); },
      getByLabel(label: string) { return locator(`label:${label}`); },
      getByText(text: string) { return locator(`text:${text}`); },
      getByTestId(testId: string) { return locator(`testId:${testId}`); },
      url() { return "http://localhost/workflows"; },
    },
  };
}

const scenario: JourneyScenario = {
  id: "happy-path",
  name: "Happy path",
  kind: "happy",
  steps: [
    {
      id: "open",
      action: { type: "navigate", url: "/workflows" },
      assertions: [{ type: "visible", locator: { by: "role", role: "heading", name: "Workflows" } }],
    },
    {
      id: "create",
      action: { type: "fill", locator: { by: "label", label: "Name" }, value: "Nightly checks" },
      assertions: [{ type: "text", locator: { by: "text", text: "Workflow status" }, value: "Workflow created" }],
    },
  ],
};

describe("user journey runner", () => {
  it("executes supported actions and assertions in order", async () => {
    const fake = fakePage();
    const result = await runJourneyScenario(fake.page, scenario);

    expect(result.status).toBe("passed");
    expect(result.steps.map((step) => step.stepId)).toEqual(["open", "create"]);
    expect(fake.calls).toEqual(["goto:/workflows", "fill:label:Name:Nightly checks"]);
  });

  it("stops at the first failed assertion with a useful result", async () => {
    const fake = fakePage();
    fake.page.getByRole = () => ({ ...fake.page.getByText("ignored"), async isVisible() { return false; } });
    const result = await runJourneyScenario(fake.page, {
      ...scenario,
      steps: [scenario.steps[0]],
    }, { assertionTimeoutMs: 10 });

    expect(result.status).toBe("failed");
    expect(result.steps[0]).toMatchObject({ stepId: "open", status: "failed" });
    expect(result.steps[0]?.error).toContain("visible");
  });
});
