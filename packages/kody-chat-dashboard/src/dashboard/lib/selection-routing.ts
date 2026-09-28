export function selectionPath(
  basePath: string,
  ...segments: Array<number | string>
): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (segments.length === 0) return base || "/";
  return `${base}/${segments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
}

export function selectionPathFromParts(
  basePath: string,
  parts: string[],
): string {
  return selectionPath(basePath, ...parts);
}
