export const BLUEPRINT_APPLY_TIMEOUT_MS = 60_000;

type BlueprintItem = { slug: string };

async function fetchJsonWithTimeout<T>(
  phase: string,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ response: Response; json: T }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    BLUEPRINT_APPLY_TIMEOUT_MS,
  );
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const json = (await response.json().catch(() => ({}))) as T;
    return { response, json };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Blueprint apply timed out while ${phase}. Try again after checking the repository connection.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type ErrorPayload = { error?: string; message?: string };

function responseError(response: Response, payload: ErrorPayload): Error {
  return new Error(
    payload.message || payload.error || `HTTP ${response.status}`,
  );
}

export async function applyStoreBlueprint(
  headers: Record<string, string>,
  item: BlueprintItem,
): Promise<{ todoSlug: string }> {
  const engine = await fetchJsonWithTimeout<ErrorPayload>(
    "installing the Kody engine",
    "/api/kody/engine/install",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({}),
    },
  );
  if (!engine.response.ok) throw responseError(engine.response, engine.json);

  const requestId = crypto.randomUUID();
  const requestResult = await fetchJsonWithTimeout<
    ErrorPayload & { todoSlug?: string }
  >("creating the Agency request", "/api/kody/agency-requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      blueprintId: item.slug,
      source: {
        kind: "store-blueprint",
        blueprintId: item.slug,
        requestId,
      },
      answers: {},
    }),
  });
  if (!requestResult.response.ok || !requestResult.json.todoSlug) {
    throw responseError(requestResult.response, requestResult.json);
  }

  const runResult = await fetchJsonWithTimeout<ErrorPayload>(
    "starting the Agency request",
    `/api/kody/agency-requests/${encodeURIComponent(requestResult.json.todoSlug)}/run`,
    { method: "POST", headers },
  );
  if (!runResult.response.ok)
    throw responseError(runResult.response, runResult.json);

  return { todoSlug: requestResult.json.todoSlug };
}
