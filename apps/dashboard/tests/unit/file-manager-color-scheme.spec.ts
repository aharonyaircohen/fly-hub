import { describe, expect, it } from "vitest";
import { resolveFileManagerColorScheme } from "@dashboard/features/file-manager/lib/color-scheme-model";

describe("resolveFileManagerColorScheme", () => {
  it.each([
    [
      "explicit dark theme",
      { explicitTheme: "dark", classTheme: "light", prefersDark: false },
      "dark",
    ],
    [
      "explicit light theme",
      { explicitTheme: "light", classTheme: "dark", prefersDark: true },
      "light",
    ],
    [
      "dark host class",
      { explicitTheme: null, classTheme: "dark", prefersDark: false },
      "dark",
    ],
    [
      "light host class",
      { explicitTheme: null, classTheme: "light", prefersDark: true },
      "light",
    ],
    [
      "dark system preference",
      { explicitTheme: null, classTheme: null, prefersDark: true },
      "dark",
    ],
    [
      "light system preference",
      { explicitTheme: null, classTheme: null, prefersDark: false },
      "light",
    ],
  ] as const)("uses the %s", (_case, signals, expected) => {
    expect(resolveFileManagerColorScheme(signals)).toBe(expected);
  });

  it("ignores unsupported explicit theme values", () => {
    expect(
      resolveFileManagerColorScheme({
        explicitTheme: "system",
        classTheme: "dark",
        prefersDark: false,
      }),
    ).toBe("dark");
  });
});
