import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPersonalBrainServices,
  resetPersonalBrainServicesForTests,
  setPersonalBrainServices,
} from "../../src/personal-services";

describe("personal Brain services", () => {
  beforeEach(() => resetPersonalBrainServicesForTests());

  it("resolves user-owned identity, credentials, and state without repository context", async () => {
    const loadState = vi.fn().mockResolvedValue({ version: 1 });
    const saveState = vi.fn().mockResolvedValue(undefined);
    setPersonalBrainServices({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "User" }),
      getCredential: vi.fn().mockResolvedValue("fly-token"),
      getCredentials: vi.fn().mockResolvedValue({ FLY_API_TOKEN: "fly-token" }),
      loadState,
      saveState,
    });

    const services = getPersonalBrainServices();
    expect(await services.resolveUser()).toEqual({
      id: "user-1",
      label: "User",
    });
    expect(await services.getCredential("user-1", "FLY_API_TOKEN")).toBe(
      "fly-token",
    );
    expect(await services.getCredentials("user-1")).toEqual({
      FLY_API_TOKEN: "fly-token",
    });
    expect(await services.loadState("user-1", "runtime")).toEqual({
      version: 1,
    });
    await services.saveState("user-1", "runtime", { version: 1 });
    expect(loadState).toHaveBeenCalledWith("user-1", "runtime");
    expect(saveState).toHaveBeenCalledWith("user-1", "runtime", { version: 1 });
  });

  it("fails closed when the host has not registered personal services", () => {
    expect(() => getPersonalBrainServices()).toThrow(
      "Personal Brain services are not registered",
    );
  });
});
