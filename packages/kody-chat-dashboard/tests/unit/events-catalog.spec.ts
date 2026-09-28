/**
 * Unit tests for the system-event catalog
 * (src/dashboard/lib/events/catalog.ts): naming convention, versioning,
 * strictness, and per-event fixture round-trips.
 */
import { describe, it, expect } from "vitest";

import {
  SYSTEM_EVENT_CATALOG,
  SYSTEM_EVENT_NAMES,
  isSystemEventName,
} from "@kody-ade/base/events/catalog";

const FIXTURES: Record<string, Record<string, unknown>> = {
  "session.started": { sessionId: "s-1" },
  "session.ended": { sessionId: "s-1" },
  "chat.message.sent": { transport: "direct" },
  "chat.response.completed": { model: "gpt", durationMs: 12 },
  "ui.view.shown": { renderer: "cards" },
  "ui.form.submitted": { viewId: "cards", fields: ["a"] },
  "ui.action.clicked": { viewId: "cards", actionId: "ok" },
  "auth.signed_in": { kind: "client", provider: "google" },
  "auth.signed_out": { kind: "operator" },
  "page.viewed": { path: "/models" },
  "model.save.proposed": { namespace: "selections", keys: ["theme"] },
  "state.entity.written": {
    namespace: "selections",
    namespaceVersion: 1,
    keys: ["theme"],
    source: "model",
  },
  "system.error": { area: "chat", message: "boom" },
  "github.workflow_run.completed": {
    runId: 42,
    conclusion: "failure",
    repository: "acme/shop",
  },
  "kody.workflow.completed": {
    workflowId: "ci-repair",
    runId: "run-42",
    status: "success",
    repository: "acme/shop",
    pr: 3947,
  },
};

describe("system event catalog", () => {
  it("uses namespaced lowercase names", () => {
    for (const name of SYSTEM_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });

  it("every entry has version >= 1 and a description", () => {
    for (const name of SYSTEM_EVENT_NAMES) {
      const def = SYSTEM_EVENT_CATALOG[name];
      expect(def.version).toBeGreaterThanOrEqual(1);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("has a passing fixture for every event", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      [...SYSTEM_EVENT_NAMES].sort(),
    );
    for (const name of SYSTEM_EVENT_NAMES) {
      const result = SYSTEM_EVENT_CATALOG[name].schema.safeParse(
        FIXTURES[name],
      );
      expect(result.success, `${name} fixture should parse`).toBe(true);
    }
  });

  it("rejects unknown payload keys (strict schemas)", () => {
    for (const name of SYSTEM_EVENT_NAMES) {
      const result = SYSTEM_EVENT_CATALOG[name].schema.safeParse({
        ...FIXTURES[name],
        __unexpected: true,
      });
      expect(result.success, `${name} should reject unknown keys`).toBe(false);
    }
  });

  it("isSystemEventName guards correctly", () => {
    expect(isSystemEventName("page.viewed")).toBe(true);
    expect(isSystemEventName("made.up")).toBe(false);
    expect(isSystemEventName("")).toBe(false);
  });
});
