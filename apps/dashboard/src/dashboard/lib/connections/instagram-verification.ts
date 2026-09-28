const DEFAULT_GRAPH_API_VERSION = "v25.0";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type InstagramVerificationResult =
  | { ok: true; externalName: string }
  | {
      ok: false;
      reason:
        | "provider_rejected"
        | "invalid_response"
        | "account_mismatch"
        | "unsupported_account_type"
        | "publishing_unavailable";
    };

export async function verifyInstagramConnection(
  input: { externalId: string; accessToken: string },
  fetcher: Fetcher = fetch,
): Promise<InstagramVerificationResult> {
  const version =
    process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() ||
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    DEFAULT_GRAPH_API_VERSION;
  const url = new URL(
    `https://graph.instagram.com/${version}/${encodeURIComponent(input.externalId)}`,
  );
  url.searchParams.set("fields", "id,username,account_type");
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { ok: false, reason: "provider_rejected" };
  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    username?: unknown;
    account_type?: unknown;
  } | null;
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.username !== "string" ||
    typeof body.account_type !== "string"
  ) {
    return { ok: false, reason: "invalid_response" };
  }
  if (body.id !== input.externalId) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (!["CREATOR", "BUSINESS"].includes(body.account_type.toUpperCase())) {
    return { ok: false, reason: "unsupported_account_type" };
  }
  const publishingUrl = new URL(
    `https://graph.instagram.com/${version}/${encodeURIComponent(input.externalId)}/content_publishing_limit`,
  );
  publishingUrl.searchParams.set("fields", "quota_usage,config");
  const publishing = await fetcher(publishingUrl, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!publishing.ok) return { ok: false, reason: "publishing_unavailable" };
  const publishingBody = (await publishing.json().catch(() => null)) as {
    data?: unknown[];
  } | null;
  if (!publishingBody || !Array.isArray(publishingBody.data)) {
    return { ok: false, reason: "publishing_unavailable" };
  }
  return { ok: true, externalName: `@${body.username}` };
}
