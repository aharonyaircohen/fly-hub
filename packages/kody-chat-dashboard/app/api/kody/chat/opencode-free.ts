/** OpenCode owns availability; models.dev owns pricing and adapter metadata. */
import { z } from "zod";

export const OPENCODE_FREE_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_CATALOG_TTL_MS = 300_000;
export interface OpenCodeFreeModel {
  id: string;
  label: string;
  adapter: "openai-compatible" | "openai-responses";
}

const liveSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(160) })).max(10_000),
});
const metadataSchema = z.object({
  opencode: z.object({
    npm: z.string(),
    models: z.record(z.string(), z.unknown()),
  }),
});
const modelSchema = z.object({
  name: z.string().min(1).max(80),
  status: z.string().optional(),
  tool_call: z.boolean(),
  cost: z
    .object({ input: z.number(), output: z.number() })
    .catchall(z.unknown()),
  provider: z.object({ npm: z.string().optional() }).optional(),
});

export function selectOpenCodeFreeModels(
  live: unknown,
  metadata: unknown,
): OpenCodeFreeModel[] {
  const ids = new Set(liveSchema.parse(live).data.map((model) => model.id));
  const provider = metadataSchema.parse(metadata).opencode;
  const result: OpenCodeFreeModel[] = [];
  for (const id of ids) {
    const parsed = modelSchema.safeParse(provider.models[id]);
    if (!parsed.success) continue;
    const model = parsed.data;
    if (
      model.status === "deprecated" ||
      !model.tool_call ||
      Object.values(model.cost).some((cost) => cost !== 0)
    )
      continue;
    const npm = model.provider?.npm ?? provider.npm;
    const adapter =
      npm === "@ai-sdk/openai-compatible"
        ? "openai-compatible"
        : npm === "@ai-sdk/openai"
          ? "openai-responses"
          : null;
    if (adapter) result.push({ id, label: model.name, adapter });
  }
  return result.sort(
    (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

export function createOpenCodeCatalog(
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let cached: { models: OpenCodeFreeModel[]; expiresAt: number } | undefined;
  let pending: Promise<OpenCodeFreeModel[]> | undefined;
  async function read(url: string) {
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("catalog request failed");
    return response.json();
  }
  return async (): Promise<OpenCodeFreeModel[]> => {
    if (cached && now() < cached.expiresAt) return cached.models;
    if (pending) return pending;
    pending = Promise.all([
      read(`${OPENCODE_FREE_BASE_URL}/models`),
      read("https://models.dev/api.json"),
    ])
      .then(([live, metadata]) => {
        const models = selectOpenCodeFreeModels(live, metadata);
        cached = { models, expiresAt: now() + OPENCODE_CATALOG_TTL_MS };
        return models;
      })
      .catch(() => {
        throw new Error(
          "OpenCode's free model list is unavailable. Try again later or choose another provider.",
        );
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

export const loadOpenCodeFreeModels = createOpenCodeCatalog();
