/**
 * @fileType util
 * @domain preview
 * @pattern convex-macro-store
 * @ai-summary Server-side store for saved preview macros, backed by the
 *   Convex backend (macros.{list,save,remove}, one row per macro, tenant
 *   scoped by owner/repo) so chat (server-side) and every device can read,
 *   rename, and delete them.
 */

import { getOwner, getRepo } from "./github-client";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "./backend/convex-backend";
import type { Macro } from "./macros";
import { slugifyTitle } from "@kody-ade/base/slug";

export const MACROS_PATH = "macros.json";

function isMacro(m: unknown): m is Macro {
  return (
    !!m &&
    typeof m === "object" &&
    typeof (m as Macro).id === "string" &&
    typeof (m as Macro).name === "string" &&
    typeof (m as Macro).createdAt === "number" &&
    Array.isArray((m as Macro).steps)
  );
}

function tenantId(): string {
  return tenantIdFor(getOwner(), getRepo());
}

async function saveMacro(macro: Macro): Promise<void> {
  await getConvexClient().mutation(backendApi.macros.save, {
    tenantId: tenantId(),
    macroId: macro.id,
    macro,
  });
}

/**
 * Read every saved macro (newest-first, matching the old localStorage
 * behavior). `sha` is always null — Convex needs no CAS token.
 */
export async function readMacrosFile(): Promise<{
  macros: Macro[];
  sha: string | null;
}> {
  const docs = (await getConvexClient().query(backendApi.macros.list, {
    tenantId: tenantId(),
  })) as Array<{ macro: unknown }>;
  const macros = docs
    .map((doc) => doc.macro)
    .filter(isMacro)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { macros, sha: null };
}

function newId(name: string): string {
  const base = slugifyTitle(name, {
    fallback: "macro",
    allowUnderscore: false,
  });
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Append a new macro (name + steps). Server stamps id + createdAt. Empty
 * names or zero-step recordings are rejected.
 */
export async function addMacroToFile(opts: {
  name: string;
  steps: Macro["steps"];
}): Promise<Macro> {
  const name = opts.name.trim().slice(0, 64);
  if (!name) throw new Error("Macro name is required");
  if (!opts.steps || opts.steps.length === 0) {
    throw new Error("A macro needs at least one step");
  }
  const macro: Macro = {
    id: newId(name),
    name,
    createdAt: Date.now(),
    steps: opts.steps,
  };
  await saveMacro(macro);
  return macro;
}

/** Delete a macro by id. Returns true if one was removed. */
export async function deleteMacroFromFile(opts: {
  id: string;
}): Promise<boolean> {
  const { macros } = await readMacrosFile();
  if (!macros.some((m) => m.id === opts.id)) return false;
  await getConvexClient().mutation(backendApi.macros.remove, {
    tenantId: tenantId(),
    macroId: opts.id,
  });
  return true;
}

/** Rename a macro by id. Returns the updated macro, or null if not found. */
export async function renameMacroInFile(opts: {
  id: string;
  name: string;
}): Promise<Macro | null> {
  const name = opts.name.trim().slice(0, 64);
  if (!name) throw new Error("New name is required");
  const { macros } = await readMacrosFile();
  const current = macros.find((m) => m.id === opts.id);
  if (!current) return null;
  const updated: Macro = { ...current, name };
  await saveMacro(updated);
  return updated;
}
