import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getViewsPreviewActionRunner,
  registerViewsPreviewActionRunner,
} from "../../src/dashboard/lib/picker/views-preview-action-runner";

describe("Views preview action runner registry", () => {
  afterEach(() => registerViewsPreviewActionRunner(null));

  it("exposes the mounted View runner to an in-flight Capability", async () => {
    const runner = vi.fn(async () => ({ ok: true }));

    registerViewsPreviewActionRunner(runner);

    expect(getViewsPreviewActionRunner()).toBe(runner);
  });

  it("does not let an older View cleanup clear a replacement runner", () => {
    const first = vi.fn(async () => ({ ok: true }));
    const replacement = vi.fn(async () => ({ ok: true }));
    const unregisterFirst = registerViewsPreviewActionRunner(first);

    registerViewsPreviewActionRunner(replacement);
    unregisterFirst();

    expect(getViewsPreviewActionRunner()).toBe(replacement);
  });

  it("shares the mounted runner across separately bundled module instances", async () => {
    const runner = vi.fn(async () => ({ ok: true }));

    registerViewsPreviewActionRunner(runner);
    vi.resetModules();
    const separatelyLoadedRegistry = await import(
      "../../src/dashboard/lib/picker/views-preview-action-runner"
    );

    expect(separatelyLoadedRegistry.getViewsPreviewActionRunner()).toBe(runner);
    separatelyLoadedRegistry.registerViewsPreviewActionRunner(null);
  });
});
