/**
 * @fileoverview Unit tests for the ChatLiveTransport contract: the
 * module-scope singleton (register / get / reset, last-wins replacement)
 * and the registry integration (capability validation + publish-on-register).
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getChatLiveTransport,
  registerChatLiveTransport,
  resetChatLiveTransportForTests,
  type ChatLiveTransport,
} from "../../../src/dashboard/lib/chat/platform/live-transport";
import {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
} from "../../../src/dashboard/lib/chat/platform/registry";
import { FULL_GRANT } from "../../../src/dashboard/lib/chat/platform/capabilities";
import type { ChatPlugin } from "../../../src/dashboard/lib/chat/platform/types";

const makeTransport = (id: string): ChatLiveTransport => ({
  id,
  subscribe: vi.fn(() => () => {}),
});

afterEach(() => {
  resetChatLiveTransportForTests();
});

describe("live-transport singleton", () => {
  it("returns null when nothing is registered", () => {
    expect(getChatLiveTransport()).toBeNull();
  });

  it("returns the registered transport", () => {
    const transport = makeTransport("a");
    registerChatLiveTransport(transport);
    expect(getChatLiveTransport()).toBe(transport);
  });

  it("last registration wins", () => {
    registerChatLiveTransport(makeTransport("a"));
    const later = makeTransport("b");
    registerChatLiveTransport(later);
    expect(getChatLiveTransport()).toBe(later);
  });

  it("reset clears the slot", () => {
    registerChatLiveTransport(makeTransport("a"));
    resetChatLiveTransportForTests();
    expect(getChatLiveTransport()).toBeNull();
  });
});

describe("registry liveTransport integration", () => {
  it("rejects a liveTransport contribution without the capability", () => {
    const registry = createChatPluginRegistry();
    const plugin: ChatPlugin = {
      id: "sneaky",
      capabilities: [],
      liveTransport: makeTransport("sneaky"),
    };
    expect(() => registry.register(plugin, FULL_GRANT)).toThrow(
      ChatPluginRegistrationError,
    );
    expect(getChatLiveTransport()).toBeNull();
  });

  it("rejects when the surface grant lacks live-transport", () => {
    const registry = createChatPluginRegistry();
    const plugin: ChatPlugin = {
      id: "ungranted",
      capabilities: ["live-transport"],
      liveTransport: makeTransport("ungranted"),
    };
    expect(() => registry.register(plugin, [])).toThrow(
      ChatPluginRegistrationError,
    );
    expect(getChatLiveTransport()).toBeNull();
  });

  it("publishes the transport to the singleton on registration", () => {
    const registry = createChatPluginRegistry();
    const transport = makeTransport("convex");
    registry.register(
      {
        id: "live-events",
        capabilities: ["live-transport"],
        liveTransport: transport,
      },
      FULL_GRANT,
    );
    expect(getChatLiveTransport()).toBe(transport);
  });

  it("re-registration from a second mount is an idempotent replace", () => {
    const transport = makeTransport("convex");
    const plugin: ChatPlugin = {
      id: "live-events",
      capabilities: ["live-transport"],
      liveTransport: transport,
    };
    // Two mounts = two registries, same plugin manifest.
    createChatPluginRegistry().register(plugin, FULL_GRANT);
    createChatPluginRegistry().register(plugin, FULL_GRANT);
    expect(getChatLiveTransport()).toBe(transport);
  });

  it("plugins without a liveTransport leave the singleton untouched", () => {
    const transport = makeTransport("convex");
    registerChatLiveTransport(transport);
    createChatPluginRegistry().register(
      { id: "plain", capabilities: [] },
      FULL_GRANT,
    );
    expect(getChatLiveTransport()).toBe(transport);
  });
});
