/** Convert saved hex colors to the HSL channel format used by the dashboard. */
function hexToHslChannels(hex: string): string {
  const value = hex.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

type BrandThemeInput = {
  accent?: string;
  colorScheme?: "light" | "dark";
  background?: string;
  foreground?: string;
  surface?: string;
  mutedForeground?: string;
  secondary?: string;
  border?: string;
  userMessage?: string;
  assistantMessage?: string;
  input?: string;
  fontSize?: "small" | "medium" | "large";
  radius?: "square" | "soft" | "rounded";
};

export interface ResolvedBrandTheme {
  accent: string;
  colorScheme: "light" | "dark";
  background: string;
  surface: string;
  foreground: string;
  mutedForeground: string;
  secondary: string;
  border: string;
  userMessage: string;
  assistantMessage: string;
  input: string;
  fontSize: "small" | "medium" | "large";
  radius: "square" | "soft" | "rounded";
}

const LIGHT_DEFAULTS = {
  surface: "#ffffff",
  mutedForeground: "#57534e",
  secondary: "#ede9fe",
  border: "#d6d3d1",
  assistantMessage: "#f5f5f4",
  input: "#ffffff",
} as const;

const DARK_DEFAULTS = {
  surface: "#111827",
  mutedForeground: "#94a3b8",
  secondary: "#1e293b",
  border: "#334155",
  assistantMessage: "#111827",
  input: "#111827",
} as const;

export function resolveBrandTheme(theme: BrandThemeInput): ResolvedBrandTheme {
  const colorScheme = theme.colorScheme ?? "dark";
  const defaults = colorScheme === "light" ? LIGHT_DEFAULTS : DARK_DEFAULTS;
  const accent = theme.accent ?? "#0f766e";
  return {
    accent,
    colorScheme,
    background:
      theme.background ?? (colorScheme === "light" ? "#f9f7f4" : "#0b1120"),
    foreground:
      theme.foreground ?? (colorScheme === "light" ? "#241f1c" : "#f8fafc"),
    surface: theme.surface ?? defaults.surface,
    mutedForeground: theme.mutedForeground ?? defaults.mutedForeground,
    secondary: theme.secondary ?? defaults.secondary,
    border: theme.border ?? defaults.border,
    userMessage: theme.userMessage ?? accent,
    assistantMessage: theme.assistantMessage ?? defaults.assistantMessage,
    input: theme.input ?? defaults.input,
    fontSize: theme.fontSize ?? "medium",
    radius: theme.radius ?? "soft",
  };
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function readableForeground(background: string): string {
  return relativeLuminance(background) > 0.45 ? "#000000" : "#ffffff";
}

const FONT_SIZE: Record<ResolvedBrandTheme["fontSize"], string> = {
  small: "15px",
  medium: "17px",
  large: "18px",
};

const RADIUS: Record<ResolvedBrandTheme["radius"], string> = {
  square: "0.25rem",
  soft: "0.75rem",
  rounded: "1rem",
};

export function brandThemeStyle(
  theme: BrandThemeInput,
): Record<string, string> {
  if (!theme.background || !theme.foreground || !theme.accent) return {};
  const resolved = resolveBrandTheme(theme);
  const primary = hexToHslChannels(resolved.accent);
  const primaryForeground = hexToHslChannels(
    readableForeground(resolved.accent),
  );
  const secondary = hexToHslChannels(resolved.secondary);
  const secondaryForeground = hexToHslChannels(
    readableForeground(resolved.secondary),
  );
  const surface = hexToHslChannels(resolved.surface);
  const foreground = hexToHslChannels(resolved.foreground);
  const border = hexToHslChannels(resolved.border);
  return {
    "--background": hexToHslChannels(resolved.background),
    "--foreground": foreground,
    "--text": foreground,
    "--card": surface,
    "--card-foreground": foreground,
    "--popover": surface,
    "--popover-foreground": foreground,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--primary-soft": secondary,
    "--secondary": secondary,
    "--secondary-foreground": secondaryForeground,
    "--accent": secondary,
    "--accent-foreground": secondaryForeground,
    "--muted": hexToHslChannels(resolved.assistantMessage),
    "--muted-foreground": hexToHslChannels(resolved.mutedForeground),
    "--border": border,
    "--input": hexToHslChannels(resolved.input),
    "--ring": primary,
    "--header-bg": surface,
    "--header-fg": foreground,
    "--hover-bg": secondary,
    "--selected-bg": secondary,
    "--selected-fg": secondaryForeground,
    "--form-bg": hexToHslChannels(resolved.input),
    "--form-border": border,
    "--form-placeholder": hexToHslChannels(resolved.mutedForeground),
    "--surface-elevated": surface,
    "--surface-elevated-fg": foreground,
    "--chat-user": hexToHslChannels(resolved.userMessage),
    "--chat-user-foreground": hexToHslChannels(
      readableForeground(resolved.userMessage),
    ),
    "--chat-assistant": hexToHslChannels(resolved.assistantMessage),
    "--chat-assistant-foreground": foreground,
    "--chat-input": hexToHslChannels(resolved.input),
    "--chat-composer": surface,
    "--chat-message-font-size": FONT_SIZE[resolved.fontSize],
    "--radius": RADIUS[resolved.radius],
  };
}
