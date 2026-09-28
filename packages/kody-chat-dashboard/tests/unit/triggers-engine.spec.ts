/**
 * Unit tests for pure trigger evaluation
 * (@kody-ade/base/triggers/engine): matching, conditions, and action data
 * mapping.
 */
import { describe, it, expect } from "vitest";

import {
  resolveActionData,
  triggerMatches,
} from "@kody-ade/base/triggers/engine";
import type { TriggerConfig } from "@kody-ade/base/triggers/types";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";

function envelope(
  name: string,
  payload: Record<string, unknown>,
): SystemEventEnvelope {
  return {
    id: "e1",
    name,
    version: 1,
    occurredAt: "2026-07-12T10:00:00.000Z",
    userId: "client:jane@example.com",
    sessionId: "s-1",
    brand: { owner: "acme", repo: "shop" },
    source: "client",
    payload,
  };
}

function trigger(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    id: "t1",
    name: "Test",
    enabled: true,
    event: "ui.form.submitted",
    conditions: [],
    action: {
      type: "save-user-state",
      namespace: "selections",
      map: { formView: "payload.viewId" },
    },
    ...overrides,
  };
}

describe("triggerMatches", () => {
  it("matches on event name when enabled", () => {
    const event = envelope("ui.form.submitted", { viewId: "intake" });
    expect(triggerMatches(trigger(), event)).toBe(true);
    expect(triggerMatches(trigger({ enabled: false }), event)).toBe(false);
    expect(triggerMatches(trigger({ event: "page.viewed" }), event)).toBe(
      false,
    );
  });

  it("applies conditions (equals, not_equals, contains, exists)", () => {
    const event = envelope("ui.form.submitted", {
      viewId: "intake",
      fields: ["email", "name"],
    });
    const match = (conditions: TriggerConfig["conditions"]) =>
      triggerMatches(trigger({ conditions }), event);

    expect(match([{ path: "viewId", op: "equals", value: "intake" }])).toBe(
      true,
    );
    expect(match([{ path: "viewId", op: "equals", value: "other" }])).toBe(
      false,
    );
    expect(match([{ path: "viewId", op: "not_equals", value: "other" }])).toBe(
      true,
    );
    expect(match([{ path: "fields", op: "contains", value: "email" }])).toBe(
      true,
    );
    expect(match([{ path: "missing", op: "exists" }])).toBe(false);
    expect(
      match([
        { path: "viewId", op: "equals", value: "intake" },
        { path: "missing", op: "exists" },
      ]),
    ).toBe(false);
  });

  it("matches the numeric GitHub workflow ID selected by the trigger form", () => {
    const event = envelope("github.workflow_run.completed", {
      workflowId: 12,
      workflowName: "CI",
      conclusion: "success",
      runId: 42,
    });

    expect(
      triggerMatches(
        trigger({
          event: "github.workflow_run.completed",
          conditions: [
            { path: "workflowId", op: "equals", value: 12 },
            { path: "conclusion", op: "equals", value: "success" },
          ],
        }),
        event,
      ),
    ).toBe(true);
  });
});

describe("resolveActionData", () => {
  it("maps payload paths, envelope fields, and literals; skips unresolved", () => {
    const event = envelope("ui.form.submitted", { viewId: "intake" });
    const data = resolveActionData(
      trigger({
        action: {
          type: "save-user-state",
          namespace: "selections",
          map: {
            view: "payload.viewId",
            what: "event.name",
            at: "event.occurredAt",
            session: "event.sessionId",
            fixed: "literal:yes",
            missing: "payload.nope",
          },
        },
      }),
      event,
    );
    expect(data).toEqual({
      view: "intake",
      what: "ui.form.submitted",
      at: "2026-07-12T10:00:00.000Z",
      session: "s-1",
      fixed: "yes",
    });
  });

  it("saves the whole payload when the map is empty", () => {
    const event = envelope("ui.form.submitted", {
      viewId: "intake",
      fields: ["a"],
    });
    const data = resolveActionData(
      trigger({
        action: {
          type: "save-user-state",
          namespace: "selections",
          map: {},
        },
      }),
      event,
    );
    expect(data).toEqual({ viewId: "intake", fields: ["a"] });
  });

  it("maps inputs for a workflow-start action", () => {
    const event = envelope("github.workflow_run.completed", {
      conclusion: "failure",
      workflow: "CI",
      runId: 42,
    });
    const data = resolveActionData(
      trigger({
        event: "github.workflow_run.completed",
        action: {
          type: "start-workflow",
          workflowId: "ci-repair",
          inputMap: {
            conclusion: "payload.conclusion",
            sourceRunId: "payload.runId",
            eventName: "event.name",
          },
        },
      }),
      event,
    );
    expect(data).toEqual({
      conclusion: "failure",
      sourceRunId: 42,
      eventName: "github.workflow_run.completed",
    });
  });

  it("maps a completed PR workflow into a reusable review workflow", () => {
    const event = envelope("github.workflow_run.completed", {
      conclusion: "success",
      workflowId: 12,
      runId: 42,
      pr: 73,
      headSha: "abc1234",
    });
    const data = resolveActionData(
      trigger({
        event: "github.workflow_run.completed",
        action: {
          type: "start-workflow",
          workflowId: "review-fix",
          inputMap: {
            pr: "payload.pr",
            headSha: "payload.headSha",
          },
        },
      }),
      event,
    );

    expect(data).toEqual({ pr: 73, headSha: "abc1234" });
  });
});
