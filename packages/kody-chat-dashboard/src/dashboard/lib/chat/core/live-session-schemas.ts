/**
 * @fileType data
 * @domain kody
 * @pattern live-session-schemas
 * @ai-summary Zod schemas for every localStorage payload read by
 *   kody-chat-live-session.ts (phase-1 hardening M5.1). Each schema replaces
 *   a bare `JSON.parse(raw) as X` cast; call sites keep their historical
 *   fallback (corrupt payload → treated as absent/empty, never a throw).
 */

import { z } from "zod";

/**
 * Brain chat-id pin map (`kody-brain-chat-ids`). Values are deliberately
 * `unknown`, not `string`: a corrupt value under one key must not discard
 * the valid pins under the others (call sites type-check per key, exactly
 * like the pre-zod code observably behaved).
 */
export const brainChatIdMapSchema = z.record(z.string(), z.unknown());

/**
 * The slice of `kody_auth` the live-session key builder needs. Extra keys
 * (token, storeRepoUrl, …) are ignored; missing/empty/non-string owner or
 * repo fails the parse and the caller falls back to the unscoped key —
 * identical to the old truthiness + implicit-crash behavior.
 */
export const kodyAuthRepoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** One persisted live-session record (see PersistedLiveSession). */
export const persistedLiveSessionSchema = z.object({
  sessionId: z.string().min(1),
  state: z.enum(["booting", "ready"]),
  startedAt: z.number(),
  target: z
    .object({
      owner: z.string(),
      repo: z.string(),
    })
    .optional(),
  runUrl: z.string().optional(),
});

/**
 * The scoped live-session map (`kody-live-sessions[:owner/repo]`). Outer
 * shape only — entries stay `unknown` so one corrupt record is dropped by
 * the per-entry prune (persistedLiveSessionSchema) without discarding its
 * healthy siblings.
 */
export const liveSessionMapSchema = z.record(z.string(), z.unknown());
