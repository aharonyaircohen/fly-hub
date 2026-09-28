/**
 * @fileType data
 * @domain features
 * @pattern builtin-feature-catalog
 * @ai-summary Dashboard-native store items ("features"). Unlike engine
 *   capabilities, a feature's code already ships in the dashboard — install
 *   just flips its slug into `company.activeFeatures` in kody.config.json
 *   and (optionally) sends the admin to a setup wizard. Defined here as
 *   builtins so no store-repo asset is required.
 */

export interface BuiltinFeature {
  slug: string;
  title: string;
  description: string;
  /** Dashboard route to a setup wizard launched after install. */
  setupHref?: string;
}

export const BUILTIN_FEATURES: readonly BuiltinFeature[] = [];

export function getBuiltinFeature(slug: string): BuiltinFeature | null {
  return BUILTIN_FEATURES.find((feature) => feature.slug === slug) ?? null;
}
