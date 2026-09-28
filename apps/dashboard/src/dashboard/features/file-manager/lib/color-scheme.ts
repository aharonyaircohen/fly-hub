"use client";

import { useSyncExternalStore } from "react";
import {
  resolveFileManagerColorScheme,
  type FileManagerColorScheme,
} from "./color-scheme-model";

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

function documentClassTheme(): FileManagerColorScheme | null {
  const classes = document.documentElement.classList;
  if (classes.contains("dark")) return "dark";
  if (classes.contains("light")) return "light";
  return null;
}

function darkModePreference(): MediaQueryList | null {
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_MODE_QUERY);
}

function currentColorScheme(): FileManagerColorScheme {
  if (typeof document === "undefined") return "light";
  return resolveFileManagerColorScheme({
    explicitTheme: document.documentElement.getAttribute("data-theme"),
    classTheme: documentClassTheme(),
    prefersDark: darkModePreference()?.matches ?? false,
  });
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  const preference = darkModePreference();
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  preference?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    preference?.removeEventListener("change", onChange);
  };
}

/** Resolves the host's standard theme signals without importing host code. */
export function useFileManagerColorScheme(): FileManagerColorScheme {
  return useSyncExternalStore(subscribe, currentColorScheme, () => "light");
}
