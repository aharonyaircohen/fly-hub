export function runtimeAppName(gatewayAppName: string): string {
  const suffix = gatewayAppName.slice(-8);
  const prefix = gatewayAppName.slice(0, 51).replace(/-+$/, "");
  return `${prefix}-rt-${suffix}`.slice(0, 63);
}
