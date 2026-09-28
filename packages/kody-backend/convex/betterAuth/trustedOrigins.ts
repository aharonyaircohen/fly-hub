export function authTrustedOrigins(environment: NodeJS.ProcessEnv): string[] {
  return [environment.SITE_URL, environment.KODY_AUTH_TRUSTED_ORIGINS]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

export function authSiteUrl(environment: NodeJS.ProcessEnv): string | undefined {
  return environment.SITE_URL?.trim() || undefined;
}
