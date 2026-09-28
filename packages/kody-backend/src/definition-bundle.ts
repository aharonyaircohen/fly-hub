import { createHash } from "node:crypto";

export interface DefinitionBundle {
  schemaVersion: 1;
  files: Record<string, string>;
}

function assertSafeDefinitionPath(path: string): void {
  const segments = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`unsafe definition path: ${path}`);
  }
}

export function normalizeDefinitionFiles(
  files: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, content]) => {
        assertSafeDefinitionPath(path);
        return [path, content.replace(/\r\n?/g, "\n")];
      }),
  );
}

export function normalizeDefinitionBundle(
  bundle: DefinitionBundle,
): DefinitionBundle {
  if (bundle.schemaVersion !== 1)
    throw new Error("unsupported definition bundle schema");
  return { schemaVersion: 1, files: normalizeDefinitionFiles(bundle.files) };
}

export function definitionVersion(bundle: DefinitionBundle): string {
  const normalized = normalizeDefinitionBundle(bundle);
  const encoded = JSON.stringify(normalized);
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

export function verifyDefinitionVersion(
  bundle: DefinitionBundle,
  version: string,
): void {
  if (definitionVersion(bundle) !== version)
    throw new Error("definition bundle hash mismatch");
}
