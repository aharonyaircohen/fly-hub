/**
 * @fileoverview Unit test for the server-only plugin tool registry entry
 * point (chat/platform/server-tools). The kody route depends on this being
 * a stable module-scope singleton: plugin server halves register at module
 * load and every request collects from the SAME instance. `server-only` is
 * stubbed by vitest.config.ts (as for every server-only module under test).
 *
 * @testFramework vitest
 * @domain chat-platform
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getChatServerToolRegistry } from "../../../src/dashboard/lib/chat/platform/server-tools";

describe("chat platform server tool registry singleton", () => {
  it("returns the same registry instance on every call", () => {
    expect(getChatServerToolRegistry()).toBe(getChatServerToolRegistry());
  });

  it("registrations are visible through later lookups (module-scope state)", () => {
    getChatServerToolRegistry().register("singleton-fixture", () => ({
      singleton_probe: {
        description: "probe",
        inputSchema: z.object({}),
        execute: async () => "ok",
      },
    }));
    expect(getChatServerToolRegistry().pluginIds()).toContain(
      "singleton-fixture",
    );
    const collected = getChatServerToolRegistry().collect({
      owner: "o",
      repo: "r",
      token: "t",
    });
    expect(Object.keys(collected)).toContain("singleton_probe");
  });
});
