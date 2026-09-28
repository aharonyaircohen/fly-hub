import type {
  JourneyAssertion,
  JourneyLocator,
  JourneyScenario,
} from "./contracts";

export interface JourneyLocatorHandle {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  isVisible(): Promise<boolean>;
  isHidden(): Promise<boolean>;
  innerText(): Promise<string>;
  isEnabled(): Promise<boolean>;
}

export interface JourneyBrowserPage {
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  getByRole(role: string, options?: { name?: string }): JourneyLocatorHandle;
  getByLabel(label: string): JourneyLocatorHandle;
  getByText(text: string): JourneyLocatorHandle;
  getByTestId(testId: string): JourneyLocatorHandle;
  url(): string;
}

export type JourneyStepResult = {
  stepId: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

export type JourneyScenarioResult = {
  status: "passed" | "failed";
  steps: JourneyStepResult[];
};

function locator(page: JourneyBrowserPage, target: JourneyLocator): JourneyLocatorHandle {
  switch (target.by) {
    case "role":
      return page.getByRole(target.role, target.name ? { name: target.name } : undefined);
    case "label":
      return page.getByLabel(target.label);
    case "text":
      return page.getByText(target.text);
    case "testId":
      return page.getByTestId(target.testId);
  }
}

async function action(page: JourneyBrowserPage, input: JourneyScenario["steps"][number]["action"]): Promise<void> {
  switch (input.type) {
    case "navigate":
      await page.goto(input.url);
      return;
    case "reload":
      await page.reload();
      return;
    case "click":
      await locator(page, input.locator).click();
      return;
    case "fill":
      await locator(page, input.locator).fill(input.value);
      return;
    case "select":
      await locator(page, input.locator).selectOption(input.value);
      return;
    case "check":
      if (input.checked) await locator(page, input.locator).check();
      else await locator(page, input.locator).uncheck();
      return;
  }
}

async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function assertion(
  page: JourneyBrowserPage,
  input: JourneyAssertion,
  timeoutMs: number,
): Promise<void> {
  switch (input.type) {
    case "visible":
      await waitFor(
        () => locator(page, input.locator).isVisible(),
        "Expected element to be visible",
        timeoutMs,
      );
      return;
    case "hidden":
      await waitFor(
        () => locator(page, input.locator).isHidden(),
        "Expected element to be hidden",
        timeoutMs,
      );
      return;
    case "text": {
      await waitFor(async () =>
        (await locator(page, input.locator).innerText()).includes(input.value),
      `Expected text to include ${JSON.stringify(input.value)}`,
      timeoutMs);
      return;
    }
    case "url":
      if (page.url() !== input.value) throw new Error(`Expected URL ${input.value}, received ${page.url()}`);
      return;
    case "enabled":
      if ((await locator(page, input.locator).isEnabled()) !== input.enabled) {
        throw new Error(`Expected element enabled=${input.enabled}`);
      }
      return;
    case "request":
      throw new Error("Request assertions require the Playwright network observer");
    case "noConsoleErrors":
      throw new Error("Console assertions require the Playwright console observer");
  }
}

export async function runJourneyScenario(
  page: JourneyBrowserPage,
  scenario: JourneyScenario,
  options?: { assertionTimeoutMs?: number },
): Promise<JourneyScenarioResult> {
  const assertionTimeoutMs = options?.assertionTimeoutMs ?? 5000;
  const steps: JourneyStepResult[] = [];
  for (const step of scenario.steps) {
    const startedAt = Date.now();
    try {
      await action(page, step.action);
      for (const check of step.assertions) await assertion(page, check, assertionTimeoutMs);
      steps.push({ stepId: step.id, status: "passed", durationMs: Date.now() - startedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Journey step failed";
      steps.push({ stepId: step.id, status: "failed", durationMs: Date.now() - startedAt, error: message });
      return { status: "failed", steps };
    }
  }
  return { status: "passed", steps };
}
