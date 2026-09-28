/** Brand theme manager. Reuses the brand API and persistence owner. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Moon, Palette, Save, Send, Sun } from "lucide-react";
import { toast } from "sonner";

import { hasReadableClientBrandAppearance } from "@kody-ade/base/client-brand";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { brandThemeStyle, resolveBrandTheme } from "../brand-theme";
import { selectionPath } from "../selection-routing";
import type { BrandRow } from "./brands-manager-types";
import { EmptyState } from "./EmptyState";
import { PageShell } from "./PageShell";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function themeQueryKey(owner?: string | null, repo?: string | null) {
  return ["kody-brands", owner ?? null, repo ?? null] as const;
}

async function listBrands(
  headers: Record<string, string>,
): Promise<BrandRow[]> {
  const response = await fetch("/api/kody/brands", {
    headers,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    brands?: BrandRow[];
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }
  return body.brands ?? [];
}

async function saveTheme(
  headers: Record<string, string>,
  brand: BrandRow,
  theme: {
    accent: string;
    appearance: NonNullable<BrandRow["appearance"]>;
  },
  actorLogin?: string,
): Promise<void> {
  const response = await fetch(
    `/api/kody/brands/${encodeURIComponent(brand.slug)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ...theme, actorLogin }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }
}

export function ThemesManager({
  selectedSlug = null,
}: {
  selectedSlug?: string | null;
}) {
  const router = useRouter();
  const { auth } = useAuth();
  const headers = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const queryKey = themeQueryKey(auth?.owner, auth?.repo);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<BrandRow[]>({
    queryKey,
    queryFn: () => listBrands(headers),
    enabled: Boolean(auth),
    staleTime: 30_000,
  });
  const brands = useMemo(() => data ?? [], [data]);
  const selectedBrand =
    brands.find((brand) => brand.slug === selectedSlug) ?? null;

  useEffect(() => {
    if (isLoading || !data) return;
    if (brands.length === 0) {
      if (selectedSlug) router.replace("/themes");
      return;
    }
    if (selectedSlug && !brands.some(({ slug }) => slug === selectedSlug)) {
      router.replace("/themes");
      return;
    }
    if (!selectedSlug) {
      router.replace(selectionPath("/themes", brands[0]!.slug));
    }
  }, [brands, data, isLoading, router, selectedSlug]);

  const updateTheme = useMutation({
    mutationFn: ({
      brand,
      theme,
    }: {
      brand: BrandRow;
      theme: {
        accent: string;
        appearance: NonNullable<BrandRow["appearance"]>;
      };
    }) => saveTheme(headers, brand, theme, auth?.user.login),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kody-brands"] });
      toast.success("Theme saved");
    },
    onError: (saveError: Error) =>
      toast.error(saveError.message || "Failed to save theme"),
  });

  const subtitle = auth ? `${auth.owner}/${auth.repo}` : undefined;

  if (isLoading) {
    return (
      <PageShell
        title="Client Themes"
        icon={Palette}
        subtitle={subtitle}
        width="wide"
      >
        <EmptyState icon={<Palette />} title="Loading client themes…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell
        title="Client Themes"
        icon={Palette}
        subtitle={subtitle}
        width="wide"
      >
        <EmptyState
          icon={<Palette />}
          title="Couldn't load client themes"
          hint={error instanceof Error ? error.message : "Unknown error"}
        />
      </PageShell>
    );
  }

  if (brands.length === 0) {
    return (
      <PageShell
        title="Client Themes"
        icon={Palette}
        subtitle={subtitle}
        width="wide"
      >
        <EmptyState
          icon={<Palette />}
          title="No brands yet"
          hint="Create a brand first, then give it a theme."
        />
      </PageShell>
    );
  }

  if (!selectedBrand) {
    return (
      <PageShell
        title="Client Themes"
        icon={Palette}
        subtitle={subtitle}
        width="wide"
      >
        <EmptyState icon={<Palette />} title="Opening theme…" />
      </PageShell>
    );
  }

  return (
    <ThemeEditor
      key={selectedBrand.slug}
      brand={selectedBrand}
      brands={brands}
      subtitle={subtitle}
      saving={updateTheme.isPending}
      onSelect={(slug) => router.push(selectionPath("/themes", slug))}
      onSave={(theme) =>
        updateTheme.mutateAsync({ brand: selectedBrand, theme })
      }
    />
  );
}

function ThemeEditor({
  brand,
  brands,
  subtitle,
  saving,
  onSelect,
  onSave,
}: {
  brand: BrandRow;
  brands: BrandRow[];
  subtitle?: string;
  saving: boolean;
  onSelect: (slug: string) => void;
  onSave: (theme: {
    accent: string;
    appearance: NonNullable<BrandRow["appearance"]>;
  }) => Promise<void>;
}) {
  const [theme, setTheme] = useState(() =>
    resolveBrandTheme({ accent: brand.accent, ...brand.appearance }),
  );
  const setThemeValue = <Key extends keyof typeof theme>(
    key: Key,
    value: (typeof theme)[Key],
  ) => setTheme((current) => ({ ...current, [key]: value }));
  const setColorScheme = (colorScheme: "light" | "dark") =>
    setTheme((current) =>
      resolveBrandTheme({
        accent: current.accent,
        colorScheme,
        fontSize: current.fontSize,
        radius: current.radius,
      }),
    );
  const colorValues = [
    theme.accent,
    theme.background,
    theme.surface,
    theme.foreground,
    theme.mutedForeground,
    theme.secondary,
    theme.border,
    theme.userMessage,
    theme.assistantMessage,
    theme.input,
  ];
  const colorsAreValid = colorValues.every((color) => HEX_RE.test(color));
  const contrastIsReadable =
    colorsAreValid && hasReadableClientBrandAppearance(theme);
  const canSave = !saving && colorsAreValid && contrastIsReadable;

  return (
    <PageShell
      title="Client Themes"
      icon={Palette}
      iconClassName="text-fuchsia-300"
      subtitle={subtitle}
      width="wide"
      actions={
        <Button type="submit" form="theme-editor-form" disabled={!canSave}>
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save theme"}
        </Button>
      }
    >
      <form
        id="theme-editor-form"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          const { accent, ...appearance } = theme;
          void onSave({
            accent,
            appearance,
          });
        }}
      >
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="font-semibold">Choose a brand</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each brand keeps its own client theme.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <Label htmlFor="theme-brand">Brand</Label>
            <select
              id="theme-brand"
              value={brand.slug}
              onChange={(event) => onSelect(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {brands.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.name} — {option.slug}
                </option>
              ))}
            </select>
          </div>
        </section>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <section className="min-w-0 space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Client preview</h2>
              <p className="text-sm text-muted-foreground">
                This updates as you change the theme.
              </p>
            </div>
            <ClientThemePreview brandName={brand.name} theme={theme} />
          </section>

          <section className="min-w-0 space-y-6 rounded-xl border border-border bg-card/40 p-5">
            <div>
              <h2 className="text-lg font-semibold">Client appearance</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Controls the complete client chat surface.
              </p>
            </div>

            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold">Style</legend>
              <div
                role="group"
                aria-label="Theme style"
                className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1"
              >
                <Button
                  type="button"
                  variant={
                    theme.colorScheme === "light" ? "secondary" : "ghost"
                  }
                  aria-pressed={theme.colorScheme === "light"}
                  onClick={() => setColorScheme("light")}
                >
                  <Sun className="h-4 w-4" /> Light
                </Button>
                <Button
                  type="button"
                  variant={theme.colorScheme === "dark" ? "secondary" : "ghost"}
                  aria-pressed={theme.colorScheme === "dark"}
                  onClick={() => setColorScheme("dark")}
                >
                  <Moon className="h-4 w-4" /> Dark
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <Label htmlFor="theme-font-size">Chat text size</Label>
                  <select
                    id="theme-font-size"
                    value={theme.fontSize}
                    onChange={(event) =>
                      setThemeValue(
                        "fontSize",
                        event.target.value as typeof theme.fontSize,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="theme-radius">Corner style</Label>
                  <select
                    id="theme-radius"
                    value={theme.radius}
                    onChange={(event) =>
                      setThemeValue(
                        "radius",
                        event.target.value as typeof theme.radius,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="square">Square</option>
                    <option value="soft">Soft</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-3 border-t border-border pt-5">
              <legend className="px-1 text-sm font-semibold">
                Brand colors
              </legend>
              <ColorField
                id="theme-primary"
                label="Primary color"
                value={theme.accent}
                fallback="#0f766e"
                onChange={(value) => setThemeValue("accent", value)}
              />
              <ColorField
                id="theme-secondary"
                label="Secondary color"
                value={theme.secondary}
                fallback="#1e293b"
                onChange={(value) => setThemeValue("secondary", value)}
              />
            </fieldset>

            <fieldset className="space-y-3 border-t border-border pt-5">
              <legend className="px-1 text-sm font-semibold">Surfaces</legend>
              <ColorField
                id="theme-background"
                label="Background color"
                value={theme.background}
                fallback="#0b1120"
                onChange={(value) => setThemeValue("background", value)}
              />
              <ColorField
                id="theme-surface"
                label="Surface color"
                value={theme.surface}
                fallback="#111827"
                onChange={(value) => setThemeValue("surface", value)}
              />
              <ColorField
                id="theme-input"
                label="Input color"
                value={theme.input}
                fallback="#111827"
                onChange={(value) => setThemeValue("input", value)}
              />
              <ColorField
                id="theme-border"
                label="Border color"
                value={theme.border}
                fallback="#334155"
                onChange={(value) => setThemeValue("border", value)}
              />
            </fieldset>

            <fieldset className="space-y-3 border-t border-border pt-5">
              <legend className="px-1 text-sm font-semibold">
                Messages and text
              </legend>
              <ColorField
                id="theme-user-message"
                label="User message color"
                value={theme.userMessage}
                fallback="#0f766e"
                onChange={(value) => setThemeValue("userMessage", value)}
              />
              <ColorField
                id="theme-assistant-message"
                label="Assistant message color"
                value={theme.assistantMessage}
                fallback="#111827"
                onChange={(value) => setThemeValue("assistantMessage", value)}
              />
              <ColorField
                id="theme-text"
                label="Text color"
                value={theme.foreground}
                fallback="#f8fafc"
                onChange={(value) => setThemeValue("foreground", value)}
              />
              <ColorField
                id="theme-muted-text"
                label="Muted text color"
                value={theme.mutedForeground}
                fallback="#94a3b8"
                onChange={(value) => setThemeValue("mutedForeground", value)}
              />
            </fieldset>

            {!colorsAreValid && (
              <p className="text-sm text-rose-300">
                Use 6-digit hex colors such as #0f766e.
              </p>
            )}
            {colorsAreValid && !contrastIsReadable && (
              <p className="text-sm text-rose-300">
                Text needs stronger contrast on the selected client surfaces.
              </p>
            )}
          </section>
        </div>
      </form>
    </PageShell>
  );
}

function ClientThemePreview({
  brandName,
  theme,
}: {
  brandName: string;
  theme: ReturnType<typeof resolveBrandTheme>;
}) {
  return (
    <div
      aria-label="Theme preview"
      data-theme={theme.colorScheme}
      className="min-h-[500px] overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl shadow-black/20"
      style={brandThemeStyle(theme)}
    >
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-5 text-card-foreground">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-primary-foreground shadow-sm"
            style={{ backgroundColor: theme.accent }}
          >
            {brandName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <p className="font-semibold">{brandName}</p>
            <p className="text-xs text-muted-foreground">Online</p>
          </div>
        </div>
        <MessageCircle className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-6 px-6 py-8">
        <div>
          <h3 className="text-2xl font-semibold">How can we help?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a conversation with our team.
          </p>
        </div>
        <div
          className="max-w-[82%] rounded-lg border border-border p-4 shadow-sm"
          style={{
            backgroundColor: "hsl(var(--chat-assistant))",
            fontSize: "var(--chat-message-font-size)",
          }}
        >
          Hi! I’m {brandName}. What can I help you with today?
        </div>
        <div
          className="ms-auto max-w-[76%] rounded-lg p-4"
          style={{
            backgroundColor: "hsl(var(--chat-user))",
            color: "hsl(var(--chat-user-foreground))",
            fontSize: "var(--chat-message-font-size)",
          }}
        >
          I need help with my account.
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
            Track an order
          </span>
          <span className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
            Contact support
          </span>
        </div>
      </div>
      <div className="mx-6 mb-6 mt-4 flex items-center gap-3 rounded-md border border-border bg-input p-2 ps-4">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Type your message…
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <Send className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-center">
      <Label htmlFor={id} className="shrink-0">
        {label}
      </Label>
      <div className="flex min-w-0 gap-2 sm:w-48 xl:w-full 2xl:w-48">
        <Input
          id={id}
          type="color"
          value={HEX_RE.test(value) ? value : fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-lg p-1"
        />
        <Input
          aria-label={`${label} hex value`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 font-mono uppercase"
        />
      </div>
    </div>
  );
}
