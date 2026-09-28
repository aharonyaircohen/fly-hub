import type { NextRequest } from "next/server";
import type {
  AutomaticModel,
  ChatModel,
} from "@kody-ade/base/variables/models";

export interface ChatModelSettingsProvider {
  load(req: NextRequest): Promise<{
    models: ChatModel[];
    automatic: AutomaticModel;
  } | null>;
  getCredential(req: NextRequest, name: string): Promise<string | null>;
}

const PROVIDER_KEY = Symbol.for("kody.chat-model-settings-provider");
type ProviderGlobal = typeof globalThis & {
  [PROVIDER_KEY]?: ChatModelSettingsProvider;
};

export function setChatModelSettingsProvider(
  provider: ChatModelSettingsProvider | null,
): void {
  const registry = globalThis as ProviderGlobal;
  if (provider) registry[PROVIDER_KEY] = provider;
  else delete registry[PROVIDER_KEY];
}

export function getChatModelSettingsProvider(): ChatModelSettingsProvider | null {
  return (globalThis as ProviderGlobal)[PROVIDER_KEY] ?? null;
}
