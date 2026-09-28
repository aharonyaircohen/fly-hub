const DEFAULT_GRAPH_API_VERSION = "v25.0";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FacebookVerificationResult =
  | { ok: true; externalName: string }
  | { ok: false; reason: "provider_rejected" | "invalid_response" | "page_mismatch" };

export async function verifyFacebookPageConnection(
  input: { externalId: string; accessToken: string },
  fetcher: Fetcher = fetch,
): Promise<FacebookVerificationResult> {
  const version =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  const url = new URL(
    `https://graph.facebook.com/${version}/${encodeURIComponent(input.externalId)}`,
  );
  url.searchParams.set("fields", "id,name");
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { ok: false, reason: "provider_rejected" };
  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    name?: unknown;
  } | null;
  if (!body || typeof body.id !== "string" || typeof body.name !== "string") {
    return { ok: false, reason: "invalid_response" };
  }
  if (body.id !== input.externalId) return { ok: false, reason: "page_mismatch" };
  return { ok: true, externalName: body.name };
}
