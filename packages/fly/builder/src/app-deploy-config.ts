export function appDeployConfig(appName: string, region: string): string {
  return `app = ${JSON.stringify(appName)}\nprimary_region = ${JSON.stringify(region)}\n`;
}
