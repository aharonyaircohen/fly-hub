/**
 * @fileType component
 * @domain chat-platform
 * @pattern plugin-slot-mounts
 * @ai-summary React context that exposes a KodyChat mount's plugin registry
 *   (per-mount instance — plan H4) to the surface pieces, plus the
 *   `ChatPluginSlot` mount point they render. With zero plugins registered a
 *   slot renders nothing at all (no wrapper element), so the admin surface's
 *   DOM is byte-identical to the pre-platform build. When contributions
 *   exist, they render inside a `display: contents` wrapper tagged
 *   `data-testid="chat-plugin-slot"` for the Playwright layers.
 *   Note: the "message-renderer" slot is declared in the contract but has no
 *   mount yet — per-message rendering needs a per-message payload on
 *   ChatSlotProps, which lands with the Step 5 plugin moves.
 */
"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ChatPluginRegistry } from "../platform";
import type { ChatSlotId } from "../platform";

interface ChatPluginContextValue {
  registry: ChatPluginRegistry;
  /** Host context snapshot handed to slot components (read-only). */
  host: Readonly<Record<string, unknown>>;
}

const ChatPluginContext = createContext<ChatPluginContextValue | null>(null);

export function ChatPluginProvider({
  registry,
  host,
  children,
}: {
  registry: ChatPluginRegistry;
  host: Readonly<Record<string, unknown>>;
  children: ReactNode;
}) {
  return (
    <ChatPluginContext.Provider value={{ registry, host }}>
      {children}
    </ChatPluginContext.Provider>
  );
}

/** The mount's registry, or `null` outside a provider (safe default). */
export function useChatPluginRegistry(): ChatPluginRegistry | null {
  return useContext(ChatPluginContext)?.registry ?? null;
}

/**
 * Mount point for one slot. Renders `null` when there is no provider or no
 * plugin contributed to the slot — zero DOM diff for plugin-free surfaces.
 * The wrapper uses `display: contents` so it never affects layout.
 */
export function ChatPluginSlot({ slot }: { slot: ChatSlotId }) {
  const ctx = useContext(ChatPluginContext);
  if (!ctx) return null;
  const contributions = ctx.registry.slots(slot);
  if (contributions.length === 0) return null;
  return (
    <div
      data-testid="chat-plugin-slot"
      data-chat-plugin-slot={slot}
      className="contents"
    >
      {contributions.map((contribution) => {
        const SlotComponent = contribution.component;
        return <SlotComponent key={contribution.id} host={ctx.host} />;
      })}
    </div>
  );
}
