import type { PreviewAction, PreviewActResult } from "./protocol";

export type ViewsPreviewActionRunner = (
  action: PreviewAction,
) => Promise<PreviewActResult>;

const RUNNER_KEY = "__kodyViewsPreviewActionRunner__";

type RunnerRegistryHost = typeof globalThis & {
  [RUNNER_KEY]?: ViewsPreviewActionRunner | null;
};

function registryHost(): RunnerRegistryHost {
  return globalThis as RunnerRegistryHost;
}

export function getViewsPreviewActionRunner(): ViewsPreviewActionRunner | null {
  return registryHost()[RUNNER_KEY] ?? null;
}

export function registerViewsPreviewActionRunner(
  runner: ViewsPreviewActionRunner | null,
): () => void {
  registryHost()[RUNNER_KEY] = runner;
  return () => {
    const host = registryHost();
    if (host[RUNNER_KEY] === runner) host[RUNNER_KEY] = null;
  };
}
