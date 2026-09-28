import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@kody-ade/backend/api", () => ({ api: { repoDocs: { get: "repoDocs:get", save: "repoDocs:save" } } }));
vi.mock("@kody-ade/backend/client", () => ({ createBackendClient: () => backend }));

import { _resetTriggersConfigCache, getTriggers, mutateTriggers } from "../src/triggers/config";

describe("Convex trigger config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetTriggersConfigCache();
  });

  it("reads trigger rules from the tenant document", async () => {
    backend.query.mockResolvedValue({ doc: { version: 1, triggers: [{ id: "one", name: "One", event: "auth.signed_in", action: { type: "save-user-state", namespace: "profile", map: {} } }] } });
    await expect(getTriggers({} as never, "acme", "app", { cache: false })).resolves.toHaveLength(1);
    expect(backend.query).toHaveBeenCalledWith("repoDocs:get", { tenantId: "acme/app", kind: "triggers/config.json" });
  });

  it("updates the Convex document with optimistic concurrency", async () => {
    backend.query.mockResolvedValue({ doc: { version: 1, triggers: [] }, updatedAt: "old" });
    backend.mutation.mockResolvedValue(undefined);
    await mutateTriggers({} as never, "acme", "app", (triggers) => [...triggers, { id: "one", name: "One", event: "auth.signed_in", action: { type: "save-user-state", namespace: "profile", map: {} } }]);
    expect(backend.mutation).toHaveBeenCalledWith("repoDocs:save", expect.objectContaining({ expectedUpdatedAt: "old", kind: "triggers/config.json" }));
  });
});
