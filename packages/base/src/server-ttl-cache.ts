/**
 * @fileType utility
 * @domain infra
 * @pattern server-ttl-cache
 *
 * Small in-process cache for server routes that poll expensive remote reads.
 */

interface ServerTtlCacheOptions {
  ttlMs: number;
  maxEntries?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ServerTtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  delete(key: string): void;
  clear(): void;
}

export function createServerTtlCache<T>({
  ttlMs,
  maxEntries = 250,
}: ServerTtlCacheOptions): ServerTtlCache<T> {
  const values = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  function prune(now: number) {
    for (const [key, entry] of values) {
      if (entry.expiresAt <= now) values.delete(key);
    }
    while (values.size > maxEntries) {
      const oldest = values.keys().next().value as string | undefined;
      if (!oldest) break;
      values.delete(oldest);
    }
  }

  return {
    async get(key, load) {
      const now = Date.now();
      const cached = values.get(key);
      if (cached && cached.expiresAt > now) return cached.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = load().then((value) => {
        values.set(key, { value, expiresAt: Date.now() + ttlMs });
        prune(Date.now());
        return value;
      });
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        inflight.delete(key);
      }
    },
    delete(key) {
      values.delete(key);
      inflight.delete(key);
    },
    clear() {
      values.clear();
      inflight.clear();
    },
  };
}
