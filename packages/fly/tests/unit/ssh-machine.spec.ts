import { unzipSync, strFromU8 } from "fflate";
import { machineSshArchive } from "../../src/ssh/archive";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMachineSshAccess,
  machineSshDownload,
} from "../../src/ssh/machine-access";
import {
  applyMachineSshAccess,
  readMachineSshAccess,
} from "../../src/ssh/machine-config";

afterEach(() => vi.unstubAllEnvs());

describe("machine SSH access", () => {
  it("creates distinct keys, stores the login key encrypted, and exports valid OpenSSH settings", async () => {
    vi.stubEnv("KODY_MASTER_KEY", "12".repeat(32));
    const first = await createMachineSshAccess({
      app: "test-app",
      port: 23001,
    });
    const second = await createMachineSshAccess({
      app: "test-app",
      port: 23002,
    });
    const download = machineSshDownload({
      app: "test-app",
      machineId: "abc123",
      access: first,
    });
    expect(first.encryptedIdentity).not.toContain("PRIVATE KEY");
    expect(first.authorizedKey).not.toEqual(second.authorizedKey);
    expect(download.config).toContain("Host kody-test-app-abc123");
    expect(download.config).toContain("StrictHostKeyChecking yes");
    expect(download.config).toContain(
      "ProxyCommand openssl s_client -quiet -connect %h:%p -servername %h -verify_return_error",
    );
    expect(download.config).not.toContain("StrictHostKeyChecking no");
    const dir = mkdtempSync(join(tmpdir(), "kody-ssh-test-"));
    try {
      const keyPath = join(dir, "identity");
      writeFileSync(keyPath, download.identity, { mode: 0o600 });
      expect(
        execFileSync("ssh-keygen", ["-y", "-f", keyPath], {
          encoding: "utf8",
        }).trim(),
      ).toBe(first.authorizedKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects injected config values and credentials from a different app", async () => {
    vi.stubEnv("KODY_MASTER_KEY", "12".repeat(32));
    const access = await createMachineSshAccess({
      app: "test-app",
      port: 23001,
    });
    expect(() =>
      machineSshDownload({ app: "other-app", machineId: "abc123", access }),
    ).toThrow();
    expect(() =>
      machineSshDownload({
        app: "test-app",
        machineId: "abc\nProxyCommand bad",
        access,
      }),
    ).toThrow();
    await expect(
      createMachineSshAccess({ app: "bad\nHost *", port: 23001 }),
    ).rejects.toThrow();
  });

  it("preserves the application and secret-backed files while preparing SSH separately", async () => {
    vi.stubEnv("KODY_MASTER_KEY", "12".repeat(32));
    const access = await createMachineSshAccess({
      app: "test-app",
      port: 23001,
      username: "browser",
    });
    const original = {
      image: "browser-image",
      init: { exec: ["/app/start.sh"] },
      env: { PORT: "8080" },
      files: [{ guest_path: "/app/secret", secret_name: "APP_SECRET" }],
      services: [
        {
          internal_port: 8080,
          ports: [{ port: 443, handlers: ["tls", "http"] }],
          autostop: false as const,
        },
      ],
    };
    const config = applyMachineSshAccess(original, access);
    expect(config.init).toEqual(original.init);
    expect(config.env).toEqual(original.env);
    expect(config.files).toContainEqual(original.files[0]);
    expect(config.services?.[0]).toEqual(original.services[0]);
    expect(config.services?.[1]).toMatchObject({
      internal_port: 22022,
      ports: [{ port: 23001, handlers: ["tls"] }],
      autostop: false,
    });
    expect(readMachineSshAccess(config)).toEqual(access);
    expect(
      machineSshDownload({ app: "test-app", machineId: "abc123", access })
        .config,
    ).toContain("User browser");
    expect(readMachineSshAccess(original)).toBeNull();
  });
});

it("downloads only client files with private Unix permissions", async () => {
  vi.stubEnv("KODY_MASTER_KEY", "12".repeat(32));
  const access = await createMachineSshAccess({ app: "test-app", port: 23001 });
  const result = machineSshArchive({
    app: "test-app",
    machineId: "abc123",
    access,
  });
  const files = unzipSync(result.bytes);
  expect(Object.keys(files).sort()).toEqual([
    "kody-test-app-abc123/Install on Mac.command",
    "kody-test-app-abc123/README.txt",
    "kody-test-app-abc123/config",
    "kody-test-app-abc123/identity",
    "kody-test-app-abc123/known_hosts",
  ]);
  expect(strFromU8(files["kody-test-app-abc123/README.txt"]!)).toContain(
    "Double-click Install on Mac.command",
  );
  expect(strFromU8(files["kody-test-app-abc123/README.txt"]!)).toContain(
    "Settings > Connections > SSH > Add",
  );
  expect(strFromU8(files["kody-test-app-abc123/config"]!)).toContain(
    "HostKeyAlias kody-test-app-abc123",
  );
  const installer = strFromU8(
    files["kody-test-app-abc123/Install on Mac.command"]!,
  );
  expect(installer).toContain("#!/bin/zsh");
  expect(installer).toContain('source_dir="${0:A:h}"');
  expect(installer).toContain("Include ~/.ssh/kody/*/config");
  expect(installer).toContain("Settings > Connections > SSH > Add");
  expect(Object.values(files).map(strFromU8).join("\n")).not.toContain(
    access.hostPrivateKey,
  );
});
