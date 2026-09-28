import { slugifyTitle } from "@kody-ade/base/slug";

const WIDGET_SLUG_MAX_LENGTH = 64;

export function normalizeWidgetName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function widgetSlugFromName(name: string): string {
  return slugifyTitle(normalizeWidgetName(name), {
    allowUnderscore: false,
    maxLength: WIDGET_SLUG_MAX_LENGTH,
  });
}

export function widgetNameFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
