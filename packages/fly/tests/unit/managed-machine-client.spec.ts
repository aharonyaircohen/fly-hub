import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/ssh/machine-config", () => ({
  prepareMachineSsh: vi.fn(async ({ config }: { config: Record<string, unknown> }) => ({
    ...config,
    files: [{ guest_path: "/etc/kody-ssh/access.enc", raw_value: "encrypted" }],
    services: [{ internal_port: 22022, autostop: "suspend", autostart: true }],
  })),
}));
import { createMachine } from "../../src/plugin/previews/machines-client";

const cfg = { token: "private-token", orgSlug: "personal", defaultRegion: "fra" };

afterEach(() => vi.unstubAllGlobals());

it.each([
  { memoryMb: 2048, sleepWhenIdle: true, autostop: "suspend" },
  { memoryMb: 4096, sleepWhenIdle: true, autostop: true },
  { memoryMb: 2048, sleepWhenIdle: false, autostop: false },
])("creates an SSH-only machine with sleep policy $autostop", async ({ memoryMb, sleepWhenIdle, autostop }) => {
  let payload: Record<string, any> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    payload = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "abc123", state: "started", region: "fra" }), { status: 200 });
  }));
  const result = await createMachine({
    appName: "flyhub-test", name: "my-machine", region: "fra",
    image: "ghcr.io/example/image:latest", memoryMb, cpus: 2,
    sshOnly: true, sleepWhenIdle,
    startupCommand: ["/bin/sh", "/etc/kody-ssh/start.sh"],
  }, cfg);
  expect(result.id).toBe("abc123");
  expect(payload.name).toBe("my-machine");
  expect(payload.config.init.exec).toEqual(["/bin/sh", "/etc/kody-ssh/start.sh"]);
  expect(payload.config.services).toEqual([{ internal_port: 22022, autostop, autostart: true }]);
  expect(payload.config.files).toContainEqual({ guest_path: "/etc/kody-ssh/access.enc", raw_value: "encrypted" });
  expect(payload.config.guest.memory_mb).toBe(memoryMb);
  expect(payload.config.restart.policy).toBe("on-failure");
});
