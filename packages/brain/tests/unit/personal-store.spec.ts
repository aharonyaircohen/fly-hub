import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetBrainAppCache,
  readBrainApp,
  writeBrainApp,
} from "../../src/store";
import { setPersonalBrainServices } from "../../src/personal-services";

describe("personal Brain state", () => {
  let activeUser = "user-a";
  const state = new Map<string, unknown>();

  beforeEach(() => {
    state.clear();
    _resetBrainAppCache();
    activeUser = "user-a";
    setPersonalBrainServices({
      resolveUser: async () => ({ id: activeUser, label: activeUser }),
      getCredential: async () => null,
      getCredentials: async () => ({}),
      loadState: async (userId, name) => state.get(`${userId}:${name}`) ?? null,
      saveState: async (userId, name, data) => {
        state.set(`${userId}:${name}`, data);
      },
    });
  });

  it("stores Brain ownership by Kody user without a repository", async () => {
    const record = {
      version: 1 as const,
      appName: "brain-a",
      orgSlug: "personal",
      createdAt: "2026-08-18T00:00:00.000Z",
    };

    await writeBrainApp("account-a", "", record);
    expect(await readBrainApp("account-a", "")).toEqual({
      ...record,
      ownerAccount: "account-a",
    });
    expect(state.get("user-a:app")).toMatchObject({ ownerAccount: "account-a" });

    activeUser = "user-b";
    _resetBrainAppCache();
    expect(await readBrainApp("account-b", "")).toBeNull();
  });
});
