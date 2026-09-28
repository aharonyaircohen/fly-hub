/**
 * @fileType util
 * @domain widgets
 * @pattern widget-host-contract
 * @ai-summary Pure helpers for the widget host: its mount contract, scoped CMS
 *   client, Kody-action validation, bundle-URL construction, and module-shape
 *   validation. Kept free of React so unit tests run in node.
 */

import type {
  CmsDocument,
  CmsListQuery,
  CmsListResult,
} from "@kody-ade/cms/types";

export interface WidgetCmsClient {
  list: (collection: string, query?: CmsListQuery) => Promise<CmsListResult>;
  get: (collection: string, id: string) => Promise<CmsDocument>;
}

export interface WidgetPostToChatRequest {
  content: string;
}

export interface WidgetSendToKodyRequest {
  message: string;
}

export interface WidgetSubmitResultRequest {
  actionId: string;
  data?: Record<string, unknown>;
}

/** Kody-owned actions available to every mounted widget. */
export interface WidgetKodyApi {
  /** Adds widget-authored text to the current chat without starting an AI turn. */
  postToChat: (request: WidgetPostToChatRequest) => void;
  /** Sends a widget-authored message through the current Kody chat pipeline. */
  sendToKody: (request: WidgetSendToKodyRequest) => void;
  /** Reports a final interaction result to the widget's current host. */
  submitResult: (request: WidgetSubmitResultRequest) => void;
}

/** Validated widget event forwarded unchanged to the owning chat surface. */
export type WidgetHostEvent =
  | { type: "post-to-chat"; content: string }
  | { type: "send-to-kody"; message: string }
  | {
      type: "submit-result";
      actionId: string;
      data?: Record<string, unknown>;
    };

/** Props the host passes to a widget's `mount(element, props)`. */
export interface WidgetMountProps {
  /** The `data` value from the widget view node — opaque to kody. */
  data: unknown;
  theme: "dark" | "light";
  /** Repository-scoped access through Kody's existing CMS permission layer. */
  cms: WidgetCmsClient;
  /** Kody interaction boundary; business behavior remains widget-owned. */
  kody: WidgetKodyApi;
}

export type WidgetCleanup = (() => void) | void;

export type WidgetMount = (
  element: HTMLElement,
  props: WidgetMountProps,
) => WidgetCleanup;

export interface WidgetBundleAuth {
  owner: string;
  repo: string;
  token: string;
}

type WidgetFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface CmsDocumentResponse {
  document?: CmsDocument;
}

function cmsCollectionPath(collection: string): string {
  return `/api/kody/cms/${encodeURIComponent(collection)}`;
}

function buildCmsListUrl(collection: string, query: CmsListQuery): string {
  const params = new URLSearchParams();
  if (query.filters && Object.keys(query.filters).length > 0) {
    params.set("filters", JSON.stringify(query.filters));
  }
  if (query.search?.query) {
    params.set("q", query.search.query);
    if (query.search.fields?.length) {
      params.set("searchFields", query.search.fields.join(","));
    }
  }
  if (query.sort?.length) {
    params.set(
      "sort",
      query.sort
        .filter((entry) => entry.field)
        .map(
          (entry) =>
            `${entry.field}:${entry.direction === "desc" ? "desc" : "asc"}`,
        )
        .join(","),
    );
  }
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  for (const id of query.ids ?? []) params.append("ids", id);
  const serialized = params.toString();
  return `${cmsCollectionPath(collection)}${serialized ? `?${serialized}` : ""}`;
}

async function requestCmsJson(
  fetcher: WidgetFetch,
  input: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetcher(input, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`CMS request failed (${response.status})`);
  }
  return await response.json().catch(() => {
    throw new Error("CMS returned an invalid response");
  });
}

function requireCmsDocument(value: unknown): CmsDocument {
  const document = (value as CmsDocumentResponse | null)?.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("CMS returned an invalid document");
  }
  return document;
}

function requireCmsList(value: unknown): CmsListResult {
  const result = value as Partial<CmsListResult> | null;
  if (
    !result ||
    !Array.isArray(result.docs) ||
    typeof result.total !== "number" ||
    typeof result.limit !== "number" ||
    typeof result.offset !== "number"
  ) {
    throw new Error("CMS returned an invalid document list");
  }
  return result as CmsListResult;
}

/**
 * Creates a CMS facade for a widget. Authentication stays inside the host
 * closure; the widget receives operations, never repository credentials.
 */
export function createWidgetCmsClient(
  authHeaders: Readonly<Record<string, string>>,
  fetcher: WidgetFetch = fetch,
): WidgetCmsClient {
  const request = (input: string, init: RequestInit = {}) =>
    requestCmsJson(fetcher, input, {
      ...init,
      headers: { ...authHeaders, ...(init.headers ?? {}) },
    });
  return {
    list: (collection, query = {}) =>
      request(buildCmsListUrl(collection, query)).then(requireCmsList),
    get: (collection, id) =>
      request(`${cmsCollectionPath(collection)}/${encodeURIComponent(id)}`, {
        method: "GET",
      }).then(requireCmsDocument),
  };
}

export function normalizeWidgetTextRequest(
  request: unknown,
  field: "content" | "message",
): string | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return null;
  }
  const value = (request as Record<string, unknown>)[field];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeWidgetSubmitResult(
  request: unknown,
): WidgetSubmitResultRequest | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return null;
  }
  const value = request as Record<string, unknown>;
  if (typeof value.actionId !== "string") return null;
  const actionId = value.actionId.trim();
  if (!actionId) return null;
  if (
    value.data !== undefined &&
    (!value.data || typeof value.data !== "object" || Array.isArray(value.data))
  ) {
    return null;
  }
  return {
    actionId,
    ...(value.data !== undefined
      ? { data: value.data as Record<string, unknown> }
      : {}),
  };
}

/**
 * Bundle URL for a widget slug, with the tenant/auth context as query
 * params (`?owner=&repo=&token=`) because `import(url)` cannot attach the
 * x-kody-* headers the rest of the API surface uses.
 */
export function buildWidgetBundleUrl(
  slug: string,
  auth?: WidgetBundleAuth,
  version?: number,
): string {
  const query = new URLSearchParams();
  if (auth) {
    query.set("owner", auth.owner);
    query.set("repo", auth.repo);
    query.set("token", auth.token);
  }
  if (version !== undefined) query.set("version", String(version));
  const suffix = query.toString();
  return `/api/kody/widgets/${encodeURIComponent(slug)}${suffix ? `?${suffix}` : ""}`;
}

/**
 * Extract the mount function from a dynamically imported widget module.
 * Returns null when the module does not follow the contract.
 */
export function resolveWidgetMount(module: unknown): WidgetMount | null {
  if (!module || typeof module !== "object") return null;
  const mount = (module as { default?: unknown }).default;
  return typeof mount === "function" ? (mount as WidgetMount) : null;
}

/** Optional widget-owned input used only by Kody's direct preview launcher. */
export function resolveWidgetPreviewData(module: unknown): unknown {
  if (!module || typeof module !== "object") return undefined;
  return (module as { previewData?: unknown }).previewData;
}
