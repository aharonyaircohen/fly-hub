import {
  getKodyRequestUserProvider,
  setKodyRequestUserProvider,
  type KodyRequestUser as ChatUserPrincipal,
  type KodyRequestUserProvider as ChatRequestContextProvider,
} from "@kody-ade/base/auth/request-user-provider";
export type { ChatUserPrincipal, ChatRequestContextProvider };

export function setChatRequestContextProvider(
  provider: ChatRequestContextProvider | null,
): void {
  setKodyRequestUserProvider(provider);
}

export function getChatRequestContextProvider(): ChatRequestContextProvider | null {
  return getKodyRequestUserProvider();
}
