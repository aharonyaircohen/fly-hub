/**
 * Unit tests for the Convex backend helper
 * (src/dashboard/lib/backend/convex-backend.ts): cached client singleton,
 * missing-CONVEX_URL error, and the tenant-id convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const convexMock = vi.hoisted(() => ({
  ctor: vi.fn(),
  mutation: vi.fn(async (..._args: unknown[]) => null),
  query: vi.fn(async (..._args: unknown[]) => null),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    url: string;
    constructor(url: string) {
      convexMock.ctor(url);
      this.url = url;
    }
    mutation(fn: unknown, args?: unknown) {
      return convexMock.mutation(fn, args);
    }
    query(fn: unknown, args?: unknown) {
      return convexMock.query(fn, args);
    }
  },
}));

import {
  _resetConvexClient,
  getConvexClient,
  tenantIdFor,
} from "@dashboard/lib/backend/convex-backend";

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

afterEach(() => {
  delete process.env.CONVEX_URL;
  _resetConvexClient();
});

describe("convex backend helper", () => {
  it("builds the client from CONVEX_URL and caches it", () => {
    const first = getConvexClient();
    const second = getConvexClient();
    expect(first).toBe(second);
    expect(convexMock.ctor).toHaveBeenCalledTimes(1);
    expect(convexMock.ctor).toHaveBeenCalledWith(
      "https://example.convex.cloud",
    );
  });

  it("throws a clear error when CONVEX_URL is unset", () => {
    delete process.env.CONVEX_URL;
    expect(() => getConvexClient()).toThrow(/CONVEX_URL is not configured/);
  });

  it("scopes tenants as owner/repo", () => {
    expect(tenantIdFor("acme", "widgets")).toBe("acme/widgets");
  });

  it("escapes reserved-prefix keys on writes (Convex reserves $/_ field names)", async () => {
    const client = getConvexClient();
    await client.mutation("viewRenderers.save" as never, {
      tenantId: "acme/widgets",
      definition: { $text: "hi", nodes: [{ _k: 1 }] },
    } as never);
    expect(convexMock.mutation).toHaveBeenCalledWith("viewRenderers.save", {
      tenantId: "acme/widgets",
      definition: { "~$text": "hi", nodes: [{ "~_k": 1 }] },
    });
  });

  it("unescapes stored payloads on reads so callers see original keys", async () => {
    convexMock.query.mockResolvedValueOnce([
      { _id: "1", definition: { "~$text": "hi" } },
    ] as never);
    const client = getConvexClient();
    const result = await client.query("viewRenderers.list" as never, {
      tenantId: "acme/widgets",
    } as never);
    expect(result).toEqual([{ _id: "1", definition: { $text: "hi" } }]);
  });
});
