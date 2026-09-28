import { describe, expect, it, vi } from "vitest";
import {
  createOpenCodeCatalog,
  selectOpenCodeFreeModels,
} from "../../app/api/kody/chat/opencode-free";

const live = {
  data: [
    { id: "free" },
    { id: "paid" },
    { id: "responses" },
    { id: "unknown" },
  ],
};
const entry = { name: "Free", cost: { input: 0, output: 0 }, tool_call: true };
const metadata = {
  opencode: {
    npm: "@ai-sdk/openai-compatible",
    models: {
      free: entry,
      paid: { ...entry, cost: { input: 1, output: 0 } },
      removed: entry,
      responses: { ...entry, provider: { npm: "@ai-sdk/openai" } },
    },
  },
};

describe("OpenCode free catalog", () => {
  it("intersects live models with zero-cost metadata and selects the declared adapter", () => {
    expect(selectOpenCodeFreeModels(live, metadata)).toEqual([
      { id: "free", label: "Free", adapter: "openai-compatible" },
      { id: "responses", label: "Free", adapter: "openai-responses" },
    ]);
  });
  it("rejects malformed catalogs instead of retaining an old free list", () => {
    expect(() => selectOpenCodeFreeModels({}, metadata)).toThrow();
    expect(() => selectOpenCodeFreeModels(live, {})).toThrow();
  });
  it("excludes deprecated, non-chat, unknown protocol, and nonzero cache pricing", () => {
    for (const change of [
      { status: "deprecated" },
      { tool_call: false },
      { provider: { npm: "unknown" } },
      { cost: { input: 0, output: 0, cache_read: 1 } },
    ]) {
      expect(
        selectOpenCodeFreeModels(
          { data: [{ id: "free" }] },
          {
            opencode: {
              npm: "@ai-sdk/openai-compatible",
              models: { free: { ...entry, ...change } },
            },
          },
        ),
      ).toEqual([]);
    }
  });
  it("deduplicates requests, refreshes removals, and fails closed after expiry", async () => {
    let now = 0;
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(url.includes("models.dev") ? metadata : live),
        ),
    );
    const load = createOpenCodeCatalog(fetcher as typeof fetch, () => now);
    const [first, second] = await Promise.all([load(), load()]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = 300_001;
    fetcher.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(url.includes("models.dev") ? metadata : { data: [] }),
        ),
    );
    expect(await load()).toEqual([]);
    now += 300_001;
    fetcher.mockRejectedValue(new Error("offline"));
    await expect(load()).rejects.toThrow("OpenCode");
  });
});
