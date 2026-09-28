import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createMachineSshAccess,
  machineSshDownload,
} from "../../src/ssh/machine-access";
import { applyMachineSshAccess } from "../../src/ssh/machine-config";
it.skipIf(process.env.KODY_SSH_IMAGES !== "1").each([
  ["kody-brain:ssh-test", "root"],
  ["kody-browser:ssh-test", "browser"],
    ["kody-preview:ssh-test", "root"],
])(
  "boots %s with its real entrypoint and preserves SSH across restart",
  async (image, username) => {
    process.env.KODY_MASTER_KEY = randomBytes(32).toString("hex");
    const root = mkdtempSync(join(tmpdir(), "kody-ssh-image-"));
    const source = join(root, "source");
    mkdirSync(source);
    chmodSync(source, 0o755);
    const client = join(root, "client");
    mkdirSync(client);
    const name = `kody-ssh-image-${Date.now()}`;
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      }).trim();
    try {
      const access = await createMachineSshAccess({
        app: "image-test",
        port: 23001,
        username,
      });
      const config = applyMachineSshAccess({}, access);
      for (const file of config.files as {
        guest_path: string;
        raw_value: string;
      }[]) {
        writeFileSync(
          join(source, file.guest_path.split("/").pop()!),
          Buffer.from(file.raw_value, "base64"),
          { mode: 0o644 },
        );
      }
      docker([
        "run",
        "-d",
        "--platform",
        "linux/amd64",
        "--name",
        name,
        "-v",
        `${source}:/etc/kody-ssh`,
        "-p",
        "127.0.0.1::22022",
        "-p",
        "127.0.0.1::8080",
        "-e",
        "BRAIN_API_KEY=ssh-image-test",
        image,
      ]);
      const port = docker(["port", name, "22022/tcp"]).split(":").pop()!;
      const download = machineSshDownload({
        app: "image-test",
        machineId: "abc",
        access,
      });
      writeFileSync(join(client, "identity"), download.identity, {
        mode: 0o600,
      });
      writeFileSync(join(client, "known_hosts"), download.knownHosts, {
        mode: 0o600,
      });
      const settings = download.config
        .replaceAll(`~/.ssh/kody/${download.alias}`, client)
        .replace("image-test.fly.dev", "127.0.0.1")
        .replace("Port 23001", `Port ${port}`)
        .split("\n")
        .filter((line) => !line.includes("ProxyCommand"))
        .join("\n");
      writeFileSync(join(client, "config"), settings);
      const ssh = (command: string) =>
        execFileSync(
          "ssh",
          [
            "-F",
            join(client, "config"),
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=3",
            download.alias,
            command,
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10000,
          },
        ).trim();
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          expect(ssh("id -un")).toBe(username);
          break;
        } catch (error) {
          if (attempt === 19)
            throw new Error(
              `SSH unavailable in ${image}: ${docker(["logs", name]).slice(-1500)}`,
            );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      if (image === "kody-brain:ssh-test")
        expect(ssh("codex --version")).toContain("codex-cli");
      expect(docker(["inspect", "--format", "{{.State.Running}}", name])).toBe(
        "true",
      );
      docker(["restart", name]);
      // Docker changes its random host mapping; Fly retains the service port.
      const restartedPort = docker(["port", name, "22022/tcp"]).split(":").pop()!;
      writeFileSync(join(client, "config"), settings.replace(`Port ${port}`, `Port ${restartedPort}`));
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(ssh("id -un")).toBe(username);
      console.log(`IMAGE: ${image}: real boot, SSH login and restart passed`);
    } finally {
      try {
        docker(["rm", "-f", name]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  120000,
);
