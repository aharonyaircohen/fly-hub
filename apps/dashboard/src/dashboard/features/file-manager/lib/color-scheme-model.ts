export type FileManagerColorScheme = "light" | "dark";

export interface FileManagerColorSchemeSignals {
  readonly explicitTheme: string | null;
  readonly classTheme: FileManagerColorScheme | null;
  readonly prefersDark: boolean;
}

function isColorScheme(value: string | null): value is FileManagerColorScheme {
  return value === "light" || value === "dark";
}

export function resolveFileManagerColorScheme({
  explicitTheme,
  classTheme,
  prefersDark,
}: FileManagerColorSchemeSignals): FileManagerColorScheme {
  if (isColorScheme(explicitTheme)) return explicitTheme;
  if (classTheme) return classTheme;
  return prefersDark ? "dark" : "light";
}
