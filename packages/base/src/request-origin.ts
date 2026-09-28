export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && forwardedProto) {
    const proto = forwardedProto;
    const forwardedOrigin = originFromValue(`${proto}://${forwardedHost}`);
    if (forwardedOrigin) return forwardedOrigin;
  }

  const directOrigin = originFromValue(req.url);
  if (!directOrigin) throw new Error("Request URL does not contain a valid origin");
  return directOrigin;
}

/** Resolve a public callback origin without trusting the browser caller. */
export function secureRequestOrigin(
  req: Request,
  environment: Record<string, string | undefined> = process.env,
): string {
  const requestValue = requestOrigin(req);
  const configured = [
    environment.KODY_PUBLIC_BASE_URL,
    environment.NEXT_PUBLIC_SERVER_URL,
    environment.VERCEL_URL
      ? `https://${environment.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined,
  ];
  const candidate = [requestValue, ...configured]
    .map((value) => originFromValue(value ?? null))
    .find((value) => value?.startsWith("https://"));
  if (!candidate) {
    throw Object.assign(
      new Error("Dashboard must be served over HTTPS before Brain can be restored."),
      { status: 503, code: "secure_dashboard_origin_required" },
    );
  }
  const parsed = new URL(candidate);
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw Object.assign(
      new Error("Dashboard must be served over HTTPS before Brain can be restored."),
      { status: 503, code: "secure_dashboard_origin_required" },
    );
  }
  return parsed.origin;
}

function originFromValue(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
