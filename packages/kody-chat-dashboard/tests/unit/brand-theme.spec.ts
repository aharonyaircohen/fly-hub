import { describe, expect, it } from "vitest";

import {
  brandThemeStyle,
  resolveBrandTheme,
} from "../../src/dashboard/lib/brand-theme";

describe("brandThemeStyle", () => {
  it("maps the chosen brand colors to the chat theme variables", () => {
    expect(
      brandThemeStyle({
        accent: "#7c3aed",
        colorScheme: "light",
        background: "#fffaf5",
        surface: "#ffffff",
        foreground: "#292524",
        mutedForeground: "#57534e",
        secondary: "#ede9fe",
        border: "#d6d3d1",
        userMessage: "#6d28d9",
        assistantMessage: "#f5f5f4",
        input: "#ffffff",
        fontSize: "large",
        radius: "rounded",
      }),
    ).toMatchObject({
      "--background": "30 100% 98%",
      "--card": "0 0% 100%",
      "--foreground": "12 6% 15%",
      "--muted-foreground": "33 5% 32%",
      "--primary": "262 83% 58%",
      "--secondary": "251 91% 95%",
      "--border": "24 6% 83%",
      "--input": "0 0% 100%",
      "--chat-user": "263 70% 50%",
      "--chat-assistant": "60 5% 96%",
      "--chat-message-font-size": "18px",
      "--radius": "1rem",
      "--ring": "262 83% 58%",
    });
  });

  it("fills legacy themes with supported client-chat defaults", () => {
    expect(
      resolveBrandTheme({
        accent: "#7c3aed",
        colorScheme: "dark",
        background: "#0b1120",
        foreground: "#f8fafc",
      }),
    ).toMatchObject({
      surface: "#111827",
      secondary: "#1e293b",
      userMessage: "#7c3aed",
      assistantMessage: "#111827",
      input: "#111827",
      fontSize: "medium",
      radius: "soft",
    });
  });
});
