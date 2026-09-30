import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, it, expect, vi } from "vitest";
import { listSavedApps } from "../../builder/src/app-image-registry";
import {
  encryptArchive,
  decryptArchive,
  machineExportScript,
  savedAppFromManifest,
  savedImageRef,
  registryImageReference,
} from "../../builder/src/app-image-format";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
describe("saved app archives", () => {
  it("reads Fly's resolved image digest without passing tag@digest to OCI tools", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      registryImageReference(`registry.fly.io/app:version@${digest}`),
    ).toBe(`registry.fly.io/app@${digest}`);
    expect(registryImageReference(`localhost:5000/app:version@${digest}`)).toBe(
      `localhost:5000/app@${digest}`,
    );
    expect(registryImageReference("node:22-alpine")).toBe("node:22-alpine");
  });
  it("shows an empty catalog before the first GHCR package exists", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    expect(await listSavedApps("owner", "test-token")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves every byte while keeping filesystem credentials out of the saved package", async () => {
    const directory = await mkdtemp(`${tmpdir()}/saved-app-test-`);
    dirs.push(directory);
    const bytes = Buffer.concat([
      Buffer.from("secret-password\nmodel-token\0"),
      Buffer.alloc(256 * 1024, 123),
    ]);
    const key = Buffer.alloc(32, 31);
    await writeFile(`${directory}/source`, bytes);
    await encryptArchive(`${directory}/source`, `${directory}/backup`, key);
    const encrypted = await readFile(`${directory}/backup`);
    expect(encrypted.includes(Buffer.from("secret-password"))).toBe(false);
    await decryptArchive(`${directory}/backup`, `${directory}/restored`, key);
    expect(await readFile(`${directory}/restored`)).toEqual(bytes);
    encrypted[40] = encrypted[40]! ^ 1;
    await writeFile(`${directory}/tampered`, encrypted);
    await expect(
      decryptArchive(`${directory}/tampered`, `${directory}/invalid`, key),
    ).rejects.toThrow();
    await expect(
      decryptArchive(
        `${directory}/backup`,
        `${directory}/wrong-key`,
        Buffer.alloc(32, 12),
      ),
    ).rejects.toThrow();
  });
  it("captures mounted app data and temporary app files, and always resumes the app", () => {
    const script = machineExportScript(`/tmp/flyhub-export-${"a".repeat(32)}`, [
      "/opt/data",
    ]);
    expect(script).toContain("export_tar -C '/opt/data'");
    expect(script).not.toContain("--exclude=tmp");
    expect(script).not.toContain("--exclude=./tmp ");
    expect(script.indexOf("trap 'resume")).toBeLessThan(
      script.indexOf("kill -STOP"),
    );
    expect(script).toContain("kill -CONT");
    expect(script).toContain("sleep 900");
    expect(() => machineExportScript("/tmp/test", [])).toThrow();
    expect(() =>
      machineExportScript(`/tmp/flyhub-export-${"a".repeat(32)}`, [
        "/opt/../etc",
      ]),
    ).toThrow();
  });
  it("accepts only FlyHub snapshots in the authenticated user's package", () => {
    const id = "a".repeat(32);
    const manifest = {
      annotations: {
        "app.flyhub.version": "1",
        "app.flyhub.source": "flyhub-app-test-123456789abc",
        "org.opencontainers.image.title": "Test app",
        "org.opencontainers.image.created": "2026-09-30T00:00:00Z",
      },
    };
    expect(savedAppFromManifest(manifest, "Owner", `app-${id}`)?.imageRef).toBe(
      `ghcr.io/owner/flyhub-saved-apps:app-${id}`,
    );
    expect(savedAppFromManifest(manifest, "owner", "unrelated")).toBeNull();
    expect(
      savedAppFromManifest(
        { annotations: { ...manifest.annotations, "app.flyhub.version": "9" } },
        "owner",
        `app-${id}`,
      ),
    ).toBeNull();
    expect(() => savedImageRef("owner/another", id)).toThrow();
  });
});
