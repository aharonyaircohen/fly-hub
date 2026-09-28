import { prepareBrainAgentFiles } from "../../src/agent-files";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getPersonalBrainServices,
  setPersonalBrainServices,
} from "../../src/personal-services";
import {
  prepareAgentAccess,
  authenticateAgentAccess,
  revokeAgentAccess,
} from "../../src/agent-access";

vi.mock("@kody-ade/base/vault/crypto", () => ({
  encrypt: (s: string) => Buffer.from(s).toString("base64url"),
  decrypt: (s: string) => Buffer.from(s, "base64url").toString(),
}));
const state = new Map<string, unknown>();
beforeEach(() => {
  state.clear();
  setPersonalBrainServices({
    resolveUser: async () => ({ id: "alice", label: "Alice" }),
    getCredential: async () => null,
    getCredentials: async () => ({}),
    loadState: async (user, name) => state.get(user + ":" + name) ?? null,
    saveState: async (user, name, data) => {
      state.set(user + ":" + name, data);
    },
  });
});
it("reuses the connection and authenticates only the currently registered app", async () => {
  const first = await prepareAgentAccess(
    "alice",
    "alice-brain",
    "https://kody.example",
  );
  const second = await prepareAgentAccess(
    "alice",
    "alice-brain",
    "https://kody.example",
  );
  expect(second).toEqual(first);
  state.set("alice:app", { appName: "alice-brain" });
  expect(await authenticateAgentAccess(first.token)).toMatchObject({
    userId: "alice",
    app: "alice-brain",
  });
  state.set("alice:app", { appName: "bob-brain" });
  expect(await authenticateAgentAccess(first.token)).toBeNull();
});
it("rejects forged and revoked access without returning secret data", async () => {
  const connection = await prepareAgentAccess(
    "alice",
    "alice-brain",
    "https://kody.example",
  );
  state.set("alice:app", { appName: "alice-brain" });
  expect(
    await authenticateAgentAccess(connection.token + "tampered"),
  ).toBeNull();
  await revokeAgentAccess("alice");
  expect(await authenticateAgentAccess(connection.token)).toBeNull();
});
it("rejects insecure or credential-bearing server URLs", async () => {
  await expect(
    prepareAgentAccess("alice", "brain", "http://example.com"),
  ).rejects.toThrow();
  await expect(
    prepareAgentAccess("alice", "brain", "https://user:pass@example.com"),
  ).rejects.toThrow();
});

it("installs only the connection and client files, not saved credential values", async () => {
  const services = getPersonalBrainServices();
  services.getCredentials = vi.fn(async () => ({ SECRET: "must-not-copy" }));
  const files = await prepareBrainAgentFiles(
    "alice-brain",
    "https://kody.example",
  );
  expect(files.map((file) => file.guest_path)).toEqual([
    "/etc/kody-agent/connection.json",
    "/etc/kody-agent/client.mjs",
    "/etc/kody-agent/setup.sh",
    "/etc/kody-agent/SKILL.md",
  ]);
  const contents = files.map((file) =>
    Buffer.from(file.raw_value, "base64").toString(),
  );
  expect(contents.join("\n")).not.toContain("must-not-copy");
  expect(JSON.parse(contents[0]).url).toBe(
    "https://kody.example/api/kody/brain/agent",
  );
  expect(services.getCredentials).not.toHaveBeenCalled();
});
it("requires a verified owner before preparing machine access", async () => {
  getPersonalBrainServices().resolveUser = async () => null;
  await expect(
    prepareBrainAgentFiles("brain", "https://kody.example"),
  ).rejects.toThrow("owner");
});
it("reuses the winning connection when two provisions race", async () => {
  const first = await prepareAgentAccess(
    "alice",
    "brain",
    "https://kody.example",
  );
  const winner = state.get("alice:agent-access");
  state.delete("alice:agent-access");
  getPersonalBrainServices().saveState = async () => {
    state.set("alice:agent-access", winner);
    throw new Error("concurrent update");
  };
  expect(
    await prepareAgentAccess("alice", "brain", "https://kody.example"),
  ).toEqual(first);
});
