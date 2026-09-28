import crypto from "node:crypto";

export type AppVerification = {
  path: string;
  expectedStatus: number;
};

type PrivateAccess = {
  repository: string;
  appId: string;
  verifyKey: Buffer;
};

function verificationUrl(origin: string, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("APP_VERIFICATION_INVALID_PATH");
  const base = new URL(origin);
  const target = new URL(path, base);
  if (target.origin !== base.origin)
    throw new Error("APP_VERIFICATION_INVALID_PATH");
  return target;
}

function launchTicket(access: PrivateAccess): string {
  const expiry = Math.floor(Date.now() / 1000) + 60;
  const signature = crypto
    .createHmac("sha256", access.verifyKey)
    .update(`${access.repository}:${access.appId}:${expiry}`)
    .digest("hex")
    .slice(0, 32);
  return Buffer.from(
    JSON.stringify({
      r: access.repository,
      a: access.appId,
      e: expiry,
      s: signature,
    }),
  ).toString("base64url");
}

async function fetchSameOrigin(
  target: URL,
  headers?: Record<string, string>,
): Promise<Response> {
  let current = target;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(3_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, current);
    if (next.origin !== target.origin)
      throw new Error("APP_VERIFICATION_UNSAFE_REDIRECT");
    current = next;
  }
  throw new Error("APP_VERIFICATION_TOO_MANY_REDIRECTS");
}

export async function waitForAppVerification(input: {
  origin: string;
  verification: AppVerification;
  privateAccess?: PrivateAccess;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<void> {
  const target = verificationUrl(input.origin, input.verification.path);
  const attempts = input.attempts ?? 30;
  const retryDelayMs = input.retryDelayMs ?? 2_000;
  let last = "unreachable";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      let cookie: string | undefined;
      if (input.privateAccess) {
        const launch = await fetch(
          `${input.origin}/?ka=${launchTicket(input.privateAccess)}`,
          { redirect: "manual", signal: AbortSignal.timeout(3_000) },
        );
        cookie = launch.headers.get("set-cookie")?.split(";", 1)[0];
        if (launch.status !== 302 || !cookie) {
          last = `authentication HTTP ${launch.status}`;
          throw new Error(last);
        }
      }
      const response = await fetchSameOrigin(
        target,
        cookie ? { cookie } : undefined,
      );
      if (response.status === input.verification.expectedStatus) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "APP_VERIFICATION_INVALID_PATH" ||
          error.message === "APP_VERIFICATION_UNSAFE_REDIRECT")
      )
        throw error;
      if (!last.startsWith("authentication HTTP"))
        last = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`APP_VERIFICATION_FAILED: ${last}`);
}
