import { it, expect } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createMachineSshAccess,
  machineSshDownload,
} from "../../src/ssh/machine-access";
import {
  applyMachineSshAccess,
  readMachineSshAccess,
} from "../../src/ssh/machine-config";
it.skipIf(process.env.KODY_SSH_LIVE !== "1").each(["root", "browser"])(
  "real shared-IP TLS SSH login as %s",
  async (username) => {
    process.env.KODY_MASTER_KEY = randomBytes(32).toString("hex");
    const token = execFileSync("flyctl", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const app = `kody-ssh-check-${Date.now()}`;
    const dir = mkdtempSync(join(tmpdir(), "kody-ssh-live-"));
    async function api(path: string, method: string, body?: unknown) {
      const res = await fetch(`https://api.machines.dev/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Fly ${method} ${path}: HTTP ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    async function ssh(args: string[]) {
      return await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        const child = spawn("ssh", args);
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => {
          stdout += data;
        });
        child.stderr.on("data", (data) => {
          stderr += data;
        });
        const timer = setTimeout(() => child.kill(), 15000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    }
    try {
      await api("/apps", "POST", { app_name: app, org_slug: "personal" });
      const ip = await fetch("https://api.fly.io/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query:
            "mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { address } } }",
          variables: { input: { appId: app, type: "shared_v4" } },
        }),
      });
      expect((await ip.json()).errors).toBeUndefined();
      const access = await createMachineSshAccess({
        app,
        port: 23123,
        username,
      });
      const startup =
        username === "root"
          ? "sh /etc/kody-ssh/start.sh"
          : "useradd --create-home browser && mkdir -p /run/sshd && runuser -u browser -- sh /etc/kody-ssh/start.sh";
      const config = applyMachineSshAccess(
        {
          image: "debian:bookworm-slim",
          init: {
            exec: [
              "sh",
              "-c",
              `apt-get update >/tmp/install.log 2>&1 && apt-get install -y openssh-server >>/tmp/install.log 2>&1 && ${startup} && sleep 600`,
            ],
          },
          guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
          auto_destroy: false,
        },
        access,
      );
      const machine = await api(`/apps/${app}/machines`, "POST", {
        region: "ams",
        config,
      });
      const fetched = await api(`/apps/${app}/machines/${machine.id}`, "GET");
      expect(readMachineSshAccess(fetched.config)?.hostPublicKey).toBe(
        access.hostPublicKey,
      );
      const download = machineSshDownload({
        app,
        machineId: machine.id,
        access,
      });
      writeFileSync(join(dir, "identity"), download.identity, { mode: 0o600 });
      writeFileSync(join(dir, "known_hosts"), download.knownHosts, {
        mode: 0o600,
      });
      writeFileSync(
        join(dir, "config"),
        download.config.replaceAll(`~/.ssh/kody/${download.alias}`, dir),
        { mode: 0o600 },
      );
      let result;
      for (let i = 0; i < 12; i++) {
        result = await ssh([
          "-F",
          join(dir, "config"),
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=8",
          download.alias,
          "printf kody-ssh-ok",
        ]);
        if (result.code === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      expect(result?.stderr, "SSH failed").not.toContain(
        "certificate verify failed",
      );
      expect(result?.stdout, result?.stderr).toBe("kody-ssh-ok");
      const other = await createMachineSshAccess({
        app,
        port: 23123,
        username,
      });
      writeFileSync(
        join(dir, "known_hosts"),
        `${download.alias} ${other.hostPublicKey}\n`,
        { mode: 0o600 },
      );
      const rejected = await ssh([
        "-F",
        join(dir, "config"),
        "-o",
        "BatchMode=yes",
        download.alias,
        "true",
      ]);
      expect(rejected.code).not.toBe(0);
      expect(rejected.stderr).toContain("HOST IDENTIFICATION HAS CHANGED");
      console.log(
        `LIVE: ${username}: shared IPv4, TLS, retained encrypted settings, native SSH exec and wrong host rejection passed`,
      );
    } finally {
      try {
        await api(`/apps/${app}?force=true`, "DELETE");
        console.log("LIVE: disposable app removed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  220000,
);
