export function todoListSelectionRedirect(
  selectedSlug: string | null | undefined,
  availableSlugs: string[],
): string | null {
  if (!selectedSlug) return null;
  return availableSlugs.includes(selectedSlug) ? null : "/todos";
}

export function todoItemSelectionRedirect(
  selectedItemId: string | null | undefined,
  availableItemIds: string[],
  listPath: string,
): string | null {
  if (!selectedItemId) return null;
  return availableItemIds.includes(selectedItemId) ? null : listPath;
}
