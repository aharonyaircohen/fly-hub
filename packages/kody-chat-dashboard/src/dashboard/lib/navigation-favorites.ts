export const MAX_NAVIGATION_FAVORITES = 8;

export interface NavigationFavoriteItem {
  href: string;
}

export function normalizeFavoriteHrefs(
  value: unknown,
  availableItems: readonly NavigationFavoriteItem[],
): string[] {
  if (!Array.isArray(value)) return [];

  const availableHrefs = new Set(availableItems.map((item) => item.href));
  const normalized: string[] = [];
  for (const href of value) {
    if (
      typeof href !== "string" ||
      !availableHrefs.has(href) ||
      normalized.includes(href)
    ) {
      continue;
    }
    normalized.push(href);
    if (normalized.length === MAX_NAVIGATION_FAVORITES) break;
  }
  return normalized;
}

export function resolveFavoriteItems<T extends NavigationFavoriteItem>(
  favoriteHrefs: readonly string[],
  availableItems: readonly T[],
): T[] {
  const itemsByHref = new Map(
    availableItems.map((item) => [item.href, item] as const),
  );
  return favoriteHrefs.flatMap((href) => {
    const item = itemsByHref.get(href);
    return item ? [item] : [];
  });
}

export function toggleFavoriteHref(
  favoriteHrefs: readonly string[],
  href: string,
): readonly string[] {
  if (favoriteHrefs.includes(href)) {
    return favoriteHrefs.filter((favoriteHref) => favoriteHref !== href);
  }
  if (favoriteHrefs.length >= MAX_NAVIGATION_FAVORITES) {
    return favoriteHrefs;
  }
  return [...favoriteHrefs, href];
}
