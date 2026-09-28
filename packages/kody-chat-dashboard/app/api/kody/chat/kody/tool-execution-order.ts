type ToolExecutor = (input: unknown, options?: unknown) => unknown;

interface ExecutableTool {
  execute?: ToolExecutor;
}

interface ToolExecutionScopeOptions {
  onError?: (name: string, error: unknown) => void;
}

const READ_ONLY_TOOL_PREFIXES = [
  "check_",
  "describe_",
  "fetch_",
  "get_",
  "inspect_",
  "list_",
  "load_",
  "read_",
  "search_",
  "show_",
  "view_",
] as const;

const READ_ONLY_TOOL_NAMES = new Set([
  "final_answer",
  "github_list_tree",
  "github_search_code",
  "kody_get_default_branch_ci",
  "list_dashboard_features",
]);

export function isReadOnlyToolName(name: string): boolean {
  return (
    READ_ONLY_TOOL_NAMES.has(name) ||
    READ_ONLY_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * Keeps reads that follow a write in the same model step from observing the
 * state that existed before the write. Independent reads still run together.
 */
export function createToolExecutionCoordinator() {
  let mutationTail: Promise<void> = Promise.resolve();
  let pendingMutations = 0;

  const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
    !!value &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function";

  const finalOutput = async (value: unknown): Promise<unknown> => {
    if (!isAsyncIterable(value)) return await value;
    let latest: unknown;
    for await (const output of value) latest = output;
    return latest;
  };

  const releaseAfterIteration = (
    iterable: AsyncIterable<unknown>,
    release: () => void,
  ): AsyncIterable<unknown> =>
    (async function* () {
      try {
        yield* iterable;
      } finally {
        release();
      }
    })();

  return {
    wrap(name: string, execute: ToolExecutor): ToolExecutor {
      if (isReadOnlyToolName(name)) {
        return (input, options) => {
          if (pendingMutations === 0) return execute(input, options);
          return mutationTail.then(() =>
            finalOutput(execute(input, options)),
          );
        };
      }

      return (input, options) => {
        const previousMutation = mutationTail;
        const startsImmediately = pendingMutations === 0;
        let releaseMutation!: () => void;
        mutationTail = new Promise<void>((resolve) => {
          releaseMutation = resolve;
        });
        pendingMutations += 1;
        const release = () => {
          pendingMutations -= 1;
          releaseMutation();
        };

        if (!startsImmediately) {
          return previousMutation
            .then(() => finalOutput(execute(input, options)))
            .finally(release);
        }

        try {
          const execution = execute(input, options);
          if (isAsyncIterable(execution)) {
            return releaseAfterIteration(execution, release);
          }
          if (
            execution &&
            (typeof execution === "object" || typeof execution === "function") &&
            "then" in execution &&
            typeof execution.then === "function"
          ) {
            return Promise.resolve(execution).finally(release);
          }
          release();
          return execution;
        } catch (error) {
          release();
          throw error;
        }
      };
    },
  };
}

/**
 * Owns ordering and error conversion for one model turn. Nested model turns
 * create a new scope so their tools cannot wait on a lock held by the parent
 * tool that started them.
 */
export function createToolExecutionScope(
  options: ToolExecutionScopeOptions = {},
) {
  const coordinator = createToolExecutionCoordinator();
  const wrapped = new WeakMap<object, unknown>();

  return {
    wrap(name: string, candidate: unknown): unknown {
      if (!candidate || typeof candidate !== "object") return candidate;
      const executable = candidate as ExecutableTool;
      if (!executable.execute) return candidate;
      const existing = wrapped.get(candidate);
      if (existing) return existing;

      const execute = coordinator.wrap(name, executable.execute);
      const failedOutput = (error: unknown) => {
        options.onError?.(name, error);
        const message = error instanceof Error ? error.message : String(error);
        return { error: message || "Tool execution failed" };
      };
      const result = {
        ...candidate,
        execute: (input: unknown, executionOptions?: unknown) => {
          let execution: unknown;
          try {
            execution = execute(input, executionOptions);
          } catch (error) {
            return failedOutput(error);
          }
          if (
            execution &&
            typeof execution === "object" &&
            Symbol.asyncIterator in execution &&
            typeof execution[Symbol.asyncIterator] === "function"
          ) {
            return (async function* () {
              try {
                yield* execution as AsyncIterable<unknown>;
              } catch (error) {
                yield failedOutput(error);
              }
            })();
          }
          if (
            execution &&
            (typeof execution === "object" || typeof execution === "function") &&
            "then" in execution &&
            typeof execution.then === "function"
          ) {
            return Promise.resolve(execution).catch(failedOutput);
          }
          return execution;
        },
      };
      wrapped.set(candidate, result);
      return result;
    },
  };
}
