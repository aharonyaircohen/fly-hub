/**
 * @fileType types
 * @domain snippets
 * @pattern snippet-contract
 * @ai-summary Generic snippet contract: named, toggleable HTML/script
 *   snippets a brand manages in the dashboard and kody injects into brand
 *   pages server-side. Kody never knows what a snippet is for — analytics,
 *   widgets, fonts are all just snippets.
 */
import { z } from "zod";

export const SNIPPET_PLACEMENTS = [
  "body-start",
  "body-end",
] as const;

export const snippetConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  /**
   * Where the snippet lands in the server-rendered page. "body-start"
   * executes before the app hydrates (earliest supported point).
   */
  placement: z.enum(SNIPPET_PLACEMENTS).default("body-start"),
  /** Raw HTML (script/meta/pixel...). Injected verbatim into brand pages. */
  html: z.string().min(1).max(10_000),
});

export const snippetsFileSchema = z.object({
  version: z.literal(1).default(1),
  snippets: z.array(snippetConfigSchema).max(50).default([]),
});

export type SnippetPlacement = (typeof SNIPPET_PLACEMENTS)[number];
export type SnippetConfig = z.infer<typeof snippetConfigSchema>;
export type SnippetsFile = z.infer<typeof snippetsFileSchema>;
