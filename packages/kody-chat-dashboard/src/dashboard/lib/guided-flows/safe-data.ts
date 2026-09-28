const SENSITIVE_DATA_KEY = /(password|secret|token|api.?key|private.?key)/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      SENSITIVE_DATA_KEY.test(key) ? [] : [[key, sanitizeValue(nested)]],
    ),
  );
}

export function sanitizeGuidedFlowData(
  value: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return (sanitizeValue(value ?? {}) as Record<string, unknown>) ?? {};
}
