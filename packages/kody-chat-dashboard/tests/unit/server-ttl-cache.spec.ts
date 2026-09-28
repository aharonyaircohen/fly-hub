import { describe, expect, it, vi } from "vitest";

import { createServerTtlCache } from "@kody-ade/base/server-ttl-cache";

describe("server ttl cache", () => {
  it("deduplicates concurrent loads for the same key", async () => {
    const cache = createServerTtlCache<string>({ ttlMs: 1_000 });
    const load = vi.fn(async () => "value");

    const [a, b] = await Promise.all([
      cache.get("same", load),
      cache.get("same", load),
    ]);

    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves cached values until the ttl expires", async () => {
    vi.useFakeTimers();
    try {
      const cache = createServerTtlCache<string>({ ttlMs: 1_000 });
      const load = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("first")
        .mockResolvedValueOnce("second");

      await expect(cache.get("key", load)).resolves.toBe("first");
      await vi.advanceTimersByTimeAsync(999);
      await expect(cache.get("key", load)).resolves.toBe("first");
      await vi.advanceTimersByTimeAsync(1);
      await expect(cache.get("key", load)).resolves.toBe("second");

      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
