export function shouldFinalizeBrainRestoreFailure(
  status: number,
  finalAttempt: boolean,
): boolean {
  const retryable =
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;
  return finalAttempt || !retryable;
}
