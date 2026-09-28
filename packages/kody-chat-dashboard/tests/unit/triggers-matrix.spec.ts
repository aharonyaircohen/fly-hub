/**
 * Full trigger matrix: replays every catalog event through the real
 * config → engine → sink → writer → service → adapter chain against an
 * in-memory CAS storage layer, mirroring the live E2E verification.
 * Also covers the negative paths: failing condition, disabled trigger,
 * and the system-source loop guard.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

const h = vi.hoisted(() => {
  interface StoredFile {
    content: string;
    sha: string;
  }
  const files = new Map<string, StoredFile>();
  const userStateDocs = new Map<
    string,
    { data: Record<string, unknown>; updatedAt: string }
  >();
  let shaCounter = 0;
  return {
    files,
    userStateDocs,
    nextSha: () => `sha-${(shaCounter += 1)}`,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("@kody-ade/base/github/core", () => ({
  createUserOctokit: vi.fn(() => ({})),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: vi.fn(async (_fn, args: Record<string, unknown>) => {
      if (args.kind === "triggers/config.json") {
        const file = h.files.get("triggers/config.json");
        return file
          ? { doc: JSON.parse(file.content), updatedAt: file.sha }
          : null;
      }
      if (typeof args.kind === "string") return null;
      const key = `${args.tenantId}:${args.namespace}:${args.userKey}`;
      return h.userStateDocs.get(key) ?? null;
    }),
    mutation: vi.fn(async (_fn, args: Record<string, unknown>) => {
      const key = `${args.tenantId}:${args.namespace}:${args.userKey}`;
      h.userStateDocs.set(key, {
        data: args.data as Record<string, unknown>,
        updatedAt: args.updatedAt as string,
      });
    }),
  }),
}));

import type { Octokit } from "@octokit/rest";
import { triggerSink } from "@kody-ade/base/triggers/sink";
import { _resetTriggersConfigCache } from "@kody-ade/base/triggers/config";
import type { TriggerConfig } from "@kody-ade/base/triggers/types";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";
import { ensureTriggerStateWriter } from "../../src/dashboard/lib/user-state/trigger-writer";
import { _resetUserStateConfigCache } from "../../src/dashboard/lib/user-state/config";
import { _resetUserStateDocCache } from "../../src/dashboard/lib/user-state/adapters/convex";
import { getUserState } from "../../src/dashboard/lib/user-state/service";

const octokit = {} as Octokit;
const USER = "operator:matrix";
const BRAND = { owner: "acme", repo: "shop" };

function trg(
  id: string,
  event: string,
  namespace: string,
  map: Record<string, string>,
  extra: Partial<TriggerConfig> = {},
): TriggerConfig {
  return {
    id,
    name: id,
    enabled: true,
    event,
    conditions: [],
    action: { type: "save-user-state", namespace, map },
    ...extra,
  };
}

const TRIGGERS: TriggerConfig[] = [
  trg("t-ses-start", "session.started", "selections", {
    s_started: "payload.sessionId",
  }),
  trg("t-ses-end", "session.ended", "selections", {
    s_ended: "payload.sessionId",
  }),
  trg("t-page", "page.viewed", "selections", { p_viewed: "payload.path" }),
  trg("t-shown", "ui.view.shown", "selections", {
    v_shown: "payload.renderer",
  }),
  trg("t-form", "ui.form.submitted", "selections", {
    f_submitted: "payload.viewId",
    f_fields: "payload.fields",
  }),
  trg("t-click", "ui.action.clicked", "selections", {
    a_clicked: "payload.actionId",
  }),
  trg("t-chat", "chat.message.sent", "selections", {
    c_sent: "payload.transport",
  }),
  trg("t-done", "chat.response.completed", "progress", {
    c_completed: "payload.model",
    c_ms: "payload.durationMs",
  }),
  trg("t-in", "auth.signed_in", "selections", { au_in: "payload.kind" }),
  trg("t-out", "auth.signed_out", "selections", { au_out: "payload.kind" }),
  trg("t-prop", "model.save.proposed", "selections", {
    m_prop: "payload.namespace",
  }),
  trg("t-err", "system.error", "selections", { sys_err: "payload.message" }),
  trg(
    "t-state",
    "state.entity.written",
    "selections",
    { state_written: "payload.namespace" },
    {
      conditions: [{ path: "source", op: "equals", value: "client" }],
    },
  ),
  trg(
    "t-neg-cond",
    "page.viewed",
    "selections",
    { neg_cond: "literal:BAD" },
    {
      conditions: [{ path: "path", op: "equals", value: "/never" }],
    },
  ),
  trg(
    "t-neg-off",
    "page.viewed",
    "selections",
    { neg_off: "literal:BAD" },
    {
      enabled: false,
    },
  ),
  trg(
    "t-neg-loop",
    "state.entity.written",
    "selections",
    { neg_loop: "literal:BAD" },
    {
      conditions: [{ path: "source", op: "equals", value: "system" }],
    },
  ),
];

const EVENTS: Array<{ name: string; payload: Record<string, unknown> }> = [
  { name: "session.started", payload: { sessionId: "s-1" } },
  { name: "session.ended", payload: { sessionId: "s-1" } },
  { name: "page.viewed", payload: { path: "/matrix" } },
  { name: "ui.view.shown", payload: { renderer: "cards" } },
  { name: "ui.form.submitted", payload: { viewId: "f-1", fields: ["a", "b"] } },
  { name: "ui.action.clicked", payload: { viewId: "f-1", actionId: "ok" } },
  { name: "chat.message.sent", payload: { transport: "direct" } },
  { name: "chat.response.completed", payload: { model: "m1", durationMs: 42 } },
  { name: "auth.signed_in", payload: { kind: "operator" } },
  { name: "auth.signed_out", payload: { kind: "operator" } },
  { name: "model.save.proposed", payload: { namespace: "stats", keys: ["k"] } },
  {
    name: "state.entity.written",
    payload: {
      namespace: "progress",
      namespaceVersion: 1,
      keys: ["record"],
      source: "client",
    },
  },
  { name: "system.error", payload: { area: "test", message: "boom" } },
];

function envelope(
  name: string,
  payload: Record<string, unknown>,
  source: SystemEventEnvelope["source"] = "server",
): SystemEventEnvelope {
  return {
    id: `e-${name}`,
    name,
    version: 1,
    occurredAt: "2026-07-12T10:00:00.000Z",
    userId: USER,
    sessionId: "s-1",
    brand: BRAND,
    source,
    payload,
  };
}

describe("trigger matrix (all catalog events)", () => {
  beforeAll(async () => {
    _resetTriggersConfigCache();
    _resetUserStateConfigCache();
    _resetUserStateDocCache();
    ensureTriggerStateWriter();
    h.files.set("triggers/config.json", {
      content: JSON.stringify({ version: 1, triggers: TRIGGERS }),
      sha: "sha-config",
    });
    for (const event of EVENTS) {
      await triggerSink.handle([envelope(event.name, event.payload)], {
        octokit,
      });
    }
    // Loop-guard probe: a system-sourced state write must not cascade.
    await triggerSink.handle(
      [
        envelope(
          "state.entity.written",
          {
            namespace: "selections",
            namespaceVersion: 1,
            keys: [],
            source: "system",
          },
          "system",
        ),
      ],
      { octokit },
    );
  });

  it("every event saved its mapped values", async () => {
    const ctx = { octokit, owner: BRAND.owner, repo: BRAND.repo, userId: USER };
    const selections = await getUserState(ctx, "selections");
    expect(selections?.data).toMatchObject({
      s_started: "s-1",
      s_ended: "s-1",
      p_viewed: "/matrix",
      v_shown: "cards",
      f_submitted: "f-1",
      f_fields: ["a", "b"],
      a_clicked: "ok",
      c_sent: "direct",
      au_in: "operator",
      au_out: "operator",
      m_prop: "stats",
      state_written: "progress",
      sys_err: "boom",
    });
    const progress = await getUserState(ctx, "progress");
    expect(progress?.data).toEqual({ c_completed: "m1", c_ms: 42 });
  });

  it("negative paths saved nothing", async () => {
    const ctx = { octokit, owner: BRAND.owner, repo: BRAND.repo, userId: USER };
    const selections = await getUserState(ctx, "selections");
    expect(selections?.data).not.toHaveProperty("neg_cond");
    expect(selections?.data).not.toHaveProperty("neg_off");
    expect(selections?.data).not.toHaveProperty("neg_loop");
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});
