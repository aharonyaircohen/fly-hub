/**
 * Unit tests for the trigger config loader/saver

 * (@kody-ade/base/triggers/config): validation, unknown-event drop, and caching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: h.query,
    mutation: h.mutation,
  }),
}));
vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));

import {
  getTriggers,
  _resetTriggersConfigCache,
} from "@kody-ade/base/triggers/config";
import type { TriggerConfig } from "@kody-ade/base/triggers/types";

const octokit = {} as Octokit;

const VALID: TriggerConfig = {
  id: "save-form",
  name: "Save form",
  enabled: true,
  event: "ui.form.submitted",
  conditions: [],
  action: {
    type: "save-user-state",
    namespace: "selections",
    map: { view: "payload.viewId" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetTriggersConfigCache();
});

describe("getTriggers", () => {
  it("returns [] when no config file exists", async () => {
    h.query.mockResolvedValue(null);
    expect(await getTriggers(octokit, "acme", "shop")).toEqual([]);
  });

  it("loads valid triggers and drops unknown-event entries", async () => {
    h.query.mockResolvedValue({
      doc: {
        version: 1,
        triggers: [VALID, { ...VALID, id: "bad-event", event: "not.real" }],
      },
      updatedAt: "s1",
    });
    const triggers = await getTriggers(octokit, "acme", "shop");
    expect(triggers.map((t) => t.id)).toEqual(["save-form"]);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "bad-event" }),
      expect.stringContaining("unknown event"),
    );
  });

  it("returns [] and warns on an invalid file", async () => {
    h.query.mockResolvedValue({
      doc: { triggers: [{ id: "NOT VALID" }] },
      updatedAt: "s1",
    });
    expect(await getTriggers(octokit, "acme", "shop")).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("caches per owner/repo", async () => {
    h.query.mockResolvedValue(null);
    await getTriggers(octokit, "acme", "shop");
    await getTriggers(octokit, "acme", "shop");
    expect(h.query).toHaveBeenCalledTimes(1);
  });
});
