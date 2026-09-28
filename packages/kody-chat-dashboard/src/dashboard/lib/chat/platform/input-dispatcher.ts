export interface ChatOperationRegistration<TResult = unknown> {
  readonly command: `/${string}`;
  readonly execute: (args: readonly string[]) => Promise<TResult>;
}

export type ChatInputDispatchResult<TResult = unknown> =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly command: `/${string}`;
      readonly result: TResult;
    };

function parseChatOperationInput(
  input: string,
): { readonly command: `/${string}`; readonly args: readonly string[] } | null {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];
  if (!command || !/^\/[a-z][a-z0-9-]*$/i.test(command)) return null;
  return {
    command: command.toLowerCase() as `/${string}`,
    args: parts.slice(1),
  };
}

export function createChatInputDispatcher<TResult = unknown>(
  registrations: readonly ChatOperationRegistration<TResult>[],
): {
  readonly dispatch: (
    input: string,
  ) => Promise<ChatInputDispatchResult<TResult>>;
} {
  const operations = new Map<string, ChatOperationRegistration<TResult>>();
  for (const registration of registrations) {
    const command = registration.command.toLowerCase();
    if (operations.has(command)) {
      throw new Error(`Duplicate chat operation "${command}"`);
    }
    operations.set(command, registration);
  }

  return {
    async dispatch(input) {
      const parsed = parseChatOperationInput(input);
      const operation = parsed ? operations.get(parsed.command) : undefined;
      if (!parsed || !operation) return { handled: false };
      return {
        handled: true,
        command: parsed.command,
        result: await operation.execute(parsed.args),
      };
    },
  };
}
