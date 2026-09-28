import { serverOperations } from "./server-operations";
import type {
  ProviderRuntimeConfig,
  ProviderTerminalBridgeInfo,
} from "./server-operations";

export type ServerProviderTerminalBridgeInfo = ProviderTerminalBridgeInfo;

export function ensureServerProviderTerminalBridge(
  cfg: ProviderRuntimeConfig,
): Promise<ServerProviderTerminalBridgeInfo> {
  return serverOperations.provider().ensureTerminalBridge(cfg);
}

export function findServerProviderTerminalBridge(
  cfg: ProviderRuntimeConfig,
): Promise<ServerProviderTerminalBridgeInfo | null> {
  return serverOperations.provider().findTerminalBridge(cfg);
}
