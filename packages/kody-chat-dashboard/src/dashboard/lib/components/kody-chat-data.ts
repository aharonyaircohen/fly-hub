"use client";

import { useEffect, useState } from "react";
import type { AutomaticModel } from "@kody-ade/base/variables/models";
import type { BrainChatModelEntry, ChatModelEntry } from "../chat/platform/agent-entries";
import { authHeaders } from "../kody-chat-live-session";

export interface ChatDataSources {
  chatModels: ChatModelEntry[];
  chatModelsLoaded: boolean;
  automatic: AutomaticModel;
  brainModels: BrainChatModelEntry[];
  brainFlyChatEnabled: boolean;
  flyConfigured: boolean;
}

type HermesModelOptions = {
  provider?: string;
  model?: string;
  providers?: Array<{
    slug?: string;
    name?: string;
    models?: Array<string | { id?: string; name?: string }>;
  }>;
};

export function hasSecretMetadata(payload: unknown, secretName: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const secrets = (payload as { secrets?: unknown }).secrets;
  return Array.isArray(secrets) && secrets.some(
    (entry) => entry !== null && typeof entry === "object" &&
      (entry as { name?: unknown }).name === secretName,
  );
}

export function hermesChatModels(options: HermesModelOptions): ChatModelEntry[] {
  const entries: ChatModelEntry[] = [];
  for (const provider of options.providers ?? []) {
    if (!provider.slug || provider.slug === "moa") continue;
    for (const raw of provider.models ?? []) {
      const model = typeof raw === "string" ? raw : raw.id;
      if (!model) continue;
      entries.push({
        id: `${provider.slug}/${model}`,
        label: `${provider.name ?? provider.slug} · ${typeof raw === "string" ? raw : raw.name ?? model}`,
        enabled: true,
        default: provider.slug === options.provider && model === options.model,
      });
    }
  }
  return entries;
}

export function useChatDataSources(): ChatDataSources {
  const [chatModels, setChatModels] = useState<ChatModelEntry[]>([]);
  const [chatModelsLoaded, setChatModelsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/kody/hermes/models", { headers: authHeaders(), cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((body: HermesModelOptions) => {
        if (!cancelled) setChatModels(hermesChatModels(body));
      })
      .catch(() => {
        if (!cancelled) setChatModels([]);
      })
      .finally(() => {
        if (!cancelled) setChatModelsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  return {
    chatModels,
    chatModelsLoaded,
    automatic: { default: false, engineDefault: false },
    brainModels: [],
    brainFlyChatEnabled: false,
    flyConfigured: false,
  };
}
