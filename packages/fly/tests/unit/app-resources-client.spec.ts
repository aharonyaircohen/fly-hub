import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addCertificate,
  createVolume,
  readAppLogs,
  snapshotVolume,
} from "../../src/apps/resources-client";

const cfg = { token: "secret-token", orgSlug: "org", defaultRegion: "fra" };
afterEach(() => vi.unstubAllGlobals());

describe("Fly App resources", () => {
  it("manages certificates without leaking the Fly token into request bodies", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await addCertificate("my-app", "api.example.com", cfg);
    expect(fetch.mock.calls[0][0]).toContain(
      "/apps/my-app/certificates/api.example.com",
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret-token",
    );
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });

  it("creates encrypted backed-up volumes and snapshots them", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
    vi.stubGlobal("fetch", fetch);
    await createVolume(
      "my-app",
      { name: "data", region: "fra", sizeGb: 10 },
      cfg,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      encrypted: true,
      auto_backup_enabled: true,
      size_gb: 10,
    });
    await snapshotVolume("my-app", "vol_1", cfg);
    expect(fetch.mock.calls[1][0]).toContain("/volumes/vol_1/snapshots");
  });

  it("isolates the unsupported HTTP logs endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"logs":[]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await readAppLogs("my-app", cfg, "cursor");
    expect(String(fetch.mock.calls[0][0])).toContain("next_token=cursor");
  });
});
