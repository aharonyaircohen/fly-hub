/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-timeouts
 *
 * Shared timeout policy for full Brain image save/restore jobs.
 */

export const DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS = 2 * 60 * 60_000;
export const BRAIN_IMAGE_JOB_OUTPUT_BYTES = 8 * 1024 * 1024;

const MIN_BRAIN_IMAGE_JOB_TIMEOUT_MS = 5 * 60_000;
const MAX_BRAIN_IMAGE_JOB_TIMEOUT_MS = 2 * 60 * 60_000;

export function brainImageJobTimeoutMs(
  raw = process.env.KODY_BRAIN_IMAGE_JOB_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS;
  }
  return Math.min(
    MAX_BRAIN_IMAGE_JOB_TIMEOUT_MS,
    Math.max(MIN_BRAIN_IMAGE_JOB_TIMEOUT_MS, Math.trunc(parsed)),
  );
}
