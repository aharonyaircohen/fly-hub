/**
 * @fileType util
 * @domain client-chat
 * @pattern client-brand-config
 * @ai-summary Chat-layer wrapper over @kody-ade/base/client-brand. The pure
 *   brand data/types/normalizers live in base; this module re-exports them
 *   and keeps `resolveClientBrand`, which reaches into @kody-ade/workspace
 *   brands storage and the github-client request context (not base-clean).
 */
export * from "@kody-ade/base/client-brand";
import {
  getBuiltinClientBrand,
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
  type ClientBrand,
  type ClientBrandResolveContext,
} from "@kody-ade/base/client-brand";

export async function resolveClientBrand(
  slug: string,
  context?: ClientBrandResolveContext | null,
): Promise<ClientBrand | null> {
  const normalized = normalizeClientBrandSlug(slug);
  if (context?.owner && context.repo) {
    const { isBrandDeleted, readBrandFile } =
      await import("@kody-ade/workspace/brands");
    const scope = { owner: context.owner, repo: context.repo };
    if (await isBrandDeleted(scope, normalized)) return null;
    const repoBrand = await readBrandFile(scope, normalized);
    if (repoBrand) {
      return {
        slug: repoBrand.slug,
        name: repoBrand.name,
        accent: repoBrand.accent,
        locale: normalizeClientBrandLocale(repoBrand.locale),
        ...(repoBrand.welcomeText !== undefined
          ? { welcomeText: repoBrand.welcomeText }
          : {}),
        ...(repoBrand.modelId !== undefined
          ? { modelId: repoBrand.modelId }
          : {}),
        ...(repoBrand.agentSlug !== undefined
          ? { agentSlug: repoBrand.agentSlug }
          : {}),
        ...(repoBrand.appearance !== undefined
          ? { appearance: repoBrand.appearance }
          : {}),
        access: repoBrand.access,
      };
    }
  }
  return getBuiltinClientBrand(normalized);
}
