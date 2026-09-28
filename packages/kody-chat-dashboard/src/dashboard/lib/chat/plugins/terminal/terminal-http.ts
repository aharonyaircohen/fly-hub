export const TERMINAL_RESIZE_TIMEOUT_MS = 3_000;
export const TERMINAL_INPUT_TIMEOUT_MS = 8_000;
export const TERMINAL_STOP_TIMEOUT_MS = 8_000;
export const LOCAL_OUTPUT_WAIT_MS = 1_500;
export const LOCAL_OUTPUT_READ_TIMEOUT_MS = 5_000;
export const TERMINAL_START_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    window.clearTimeout(timeout),
  );
}
