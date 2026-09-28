export type ChatOperationRequestResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly command: string;
      readonly result: Readonly<Record<string, unknown>>;
    };

export class ChatOperationRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ChatOperationRequestError";
  }
}

export async function requestChatOperation(
  input: string,
  headers: Readonly<Record<string, string>>,
): Promise<ChatOperationRequestResult> {
  const response = await fetch("/api/kody/chat/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ input }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new ChatOperationRequestError(
      typeof payload.error === "string"
        ? payload.error
        : "chat_operation_failed",
    );
  }
  if (payload.handled !== true) return { handled: false };
  if (
    typeof payload.command !== "string" ||
    !payload.result ||
    typeof payload.result !== "object" ||
    Array.isArray(payload.result)
  ) {
    throw new ChatOperationRequestError("invalid_chat_operation_response");
  }
  return {
    handled: true,
    command: payload.command,
    result: payload.result as Readonly<Record<string, unknown>>,
  };
}
