import type { NextRequest } from "next/server";

export function guidedFlowInternalJsonHeaders(
  req: NextRequest,
  idempotencyKey: string,
): Headers {
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.set("x-kody-idempotency-key", idempotencyKey);
  // The new fetch owns framing for its JSON body. Forwarding the incoming
  // framing headers makes Undici reject the internal request in production.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}
