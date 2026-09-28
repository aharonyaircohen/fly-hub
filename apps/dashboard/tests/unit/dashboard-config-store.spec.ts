/**
 * Unit tests for the Convex-backed dashboard config store
 * (src/dashboard/lib/dashboard-config/store.ts): repoDocs.get/save with the
 * right tenantId and doc shape, and cache behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  invalidateDashboardConfigCache,
  readDashboardConfig,
  writeDashboardConfig,
  type DashboardConfig,
} from "@dashboard/lib/dashboard-config/store";

const DOC: DashboardConfig = {
  version: 1,
  defaultPreviewUrl: "https://preview.example",
  namedPreviews: [
    {
      id: "web",
      label: "Web",
      url: "https://preview.example",
      repoViewPath: "legacy/views/legacy-view",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
  invalidateDashboardConfigCache("acme", "widgets");
});

describe("dashboard config store", () => {
  it("reads the dashboard-config repoDoc for the tenant", async () => {
    convex.query.mockResolvedValue({ doc: DOC });

    const { doc, sha } = await readDashboardConfig("acme",
      "widgets",
    );

    expect(doc).toEqual(DOC);
    expect(sha).toBeNull();
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      kind: "dashboard-config",
    });
  });

  it("returns an empty doc when no repoDoc exists", async () => {
    convex.query.mockResolvedValue(null);
    const { doc } = await readDashboardConfig("acme", "widgets");
    expect(doc).toEqual({ version: 1 });
  });

  it("writes the dashboard-config repoDoc for the tenant", async () => {
    convex.mutation.mockResolvedValue("id-1");

    await writeDashboardConfig("acme", "widgets", DOC);

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      kind: "dashboard-config",
      doc: DOC,
    });
    expect(typeof (args as { updatedAt: string }).updatedAt).toBe("string");
  });

  it("serves the written doc from cache without re-querying", async () => {
    convex.mutation.mockResolvedValue("id-1");
    await writeDashboardConfig("acme", "widgets", DOC);

    const { doc } = await readDashboardConfig("acme", "widgets");
    expect(doc).toEqual(DOC);
    expect(convex.query).not.toHaveBeenCalled();
  });
});
