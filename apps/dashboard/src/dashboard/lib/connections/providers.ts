export interface ConnectionProviderDefinition {
  id: "facebook" | "instagram";
  connectionId: string;
  displayName: string;
  defaultName: string;
  accountType: "page" | "professional";
  externalIdLabel: string;
  accessTokenRef: string;
}

export const CONNECTION_PROVIDERS: readonly ConnectionProviderDefinition[] = [
  {
    id: "facebook",
    connectionId: "facebook-main",
    displayName: "Facebook Page",
    defaultName: "Facebook Page",
    accountType: "page",
    externalIdLabel: "Facebook Page ID",
    accessTokenRef: "FACEBOOK_PAGE_ACCESS_TOKEN",
  },
  {
    id: "instagram",
    connectionId: "instagram-main",
    displayName: "Instagram",
    defaultName: "Instagram Creator",
    accountType: "professional",
    externalIdLabel: "Instagram account ID",
    accessTokenRef: "INSTAGRAM_ACCESS_TOKEN",
  },
] as const;

export function connectionProvider(
  provider: string,
  accountType: string,
): ConnectionProviderDefinition | null {
  return CONNECTION_PROVIDERS.find(
    (candidate) =>
      candidate.id === provider && candidate.accountType === accountType,
  ) ?? null;
}
