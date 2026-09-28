export function readableResourceResult(result: unknown): unknown {
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    result.status === 404
  ) {
    return { found: false };
  }
  return result;
}
