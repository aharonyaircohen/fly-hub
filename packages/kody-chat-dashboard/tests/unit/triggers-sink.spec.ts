/**
 * Unit tests for the trigger sink (@kody-ade/base/triggers/sink): matching
 * triggers write through the injected state writer, system-sourced events
 * are skipped (loop guard), missing writer/octokit no-ops, and a failing
 * trigger is isolated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getTriggers: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  resolveBackgroundToken: vi.fn(),
}));

vi.mock("@kody-ade/base/triggers/config", () => ({
  getTriggers: h.getTriggers,
  _resetTriggersConfigCache: vi.fn(),
}));
vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: h.resolveBackgroundToken,
}));
vi.mock("@kody-ade/base/github/core", () => ({
  createUserOctokit: vi.fn(() => ({ background: true })),
}));

import { triggerSink } from "@kody-ade/base/triggers/sink";
import {
  setTriggerStateWriter,
  type TriggerStateWrite,
} from "@kody-ade/base/triggers/state-writer";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";
import type { TriggerConfig } from "@kody-ade/base/triggers/types";

const TRIGGER: TriggerConfig = {
  id: "t1",
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

function envelope(
  overrides: Partial<SystemEventEnvelope> = {},
): SystemEventEnvelope {
  return {
    id: "e1",
    name: "ui.form.submitted",
    version: 1,
    occurredAt: "2026-07-12T10:00:00.000Z",
    userId: "client:jane@example.com",
    sessionId: "s-1",
    brand: { owner: "acme", repo: "shop" },
    source: "client",
    payload: { viewId: "intake" },
    ...overrides,
  };
}

const octokit = { fake: true };
let writes: TriggerStateWrite[];
let writer: ReturnType<typeof vi.fn<(write: TriggerStateWrite) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();
  h.getTriggers.mockResolvedValue([TRIGGER]);
  h.resolveBackgroundToken.mockResolvedValue(null);
  writes = [];
  writer = vi.fn<(write: TriggerStateWrite) => Promise<void>>(
    async (write) => {
      writes.push(write);
    },
  );
  setTriggerStateWriter(writer);
});

describe("triggerSink", () => {
  it("saves mapped data for a matching event", async () => {
    await triggerSink.handle([envelope()], { octokit });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      owner: "acme",
      repo: "shop",
      userId: "client:jane@example.com",
      namespace: "selections",
      data: { view: "intake" },
    });
  });

  it("skips system-sourced events (loop guard)", async () => {
    await triggerSink.handle([envelope({ source: "system" })], { octokit });
    expect(writer).not.toHaveBeenCalled();
  });

  it("skips events without brand or user", async () => {
    await triggerSink.handle(
      [envelope({ brand: null }), envelope({ userId: null })],
      { octokit },
    );
    expect(writer).not.toHaveBeenCalled();
  });

  it("isolates a failing trigger write", async () => {
    writer.mockRejectedValue(new Error("boom"));
    await expect(
      triggerSink.handle([envelope()], { octokit }),
    ).resolves.toBeUndefined();
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "t1" }),
      "trigger execution failed",
    );
  });

  it("no-ops without an installed writer", async () => {
    setTriggerStateWriter(undefined as never);
    await triggerSink.handle([envelope()], { octokit });
    expect(h.getTriggers).not.toHaveBeenCalled();
  });

  it("no-ops when no octokit is resolvable", async () => {
    await triggerSink.handle([envelope()], { octokit: null });
    expect(writer).not.toHaveBeenCalled();
  });
});
