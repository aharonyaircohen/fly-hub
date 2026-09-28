import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  ips: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listMachines: mocks.list,
  allocateSharedIps: mocks.ips,
  updateMachineConfig: mocks.update,
}));
import {
  prepareMachineSsh,
  readMachineSshAccess,
} from "../../src/ssh/machine-config";
const cfg = { token: "private", orgSlug: "personal", defaultRegion: "ams" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("KODY_MASTER_KEY", "12".repeat(32));
  mocks.list.mockResolvedValue([]);
  mocks.ips.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("prepares credentials and shared routing as part of creation", async () => {
  const config = await prepareMachineSsh({
    app: "test-app",
    config: { image: "image" },
    cfg,
  });
  expect(readMachineSshAccess(config)?.app).toBe("test-app");
  expect(mocks.ips).toHaveBeenCalledWith("test-app", cfg);
});
it("does not change standalone creation without a credential vault", async () => {
  vi.stubEnv("KODY_MASTER_KEY", "");
  const config = { image: "image" };
  expect(await prepareMachineSsh({ app: "test-app", config, cfg })).toBe(
    config,
  );
  expect(mocks.list).not.toHaveBeenCalled();
});
