/**
 * @fileType library
 * @domain runners
 * @pattern fly-machines-client
 *
 * Thin client for the Fly Machines API — spawn a one-shot machine that
 * runs the kody engine. Used as a parallel runtime to GitHub Actions
 * for the kody-live-fly agent (POC).
 *
 * @ai-summary One-shot Fly Machines spawner for kody-live sessions.
 *   auto_destroy=true, restart=no — machine is always recycled after exit.
 *   The caller is responsible for writing session meta BEFORE calling
 *   spawnRunner; if spawn succeeds but the writer fails, the machine idles
 *   and the session is orphaned with no events in the feed.
 *
 * Reference: https://docs.machines.dev/swagger/index.html
 */

import { logger } from "@kody-ade/base/logger";
import { prepareMachineSsh } from "../../ssh/machine-config";
import type { EngineExecutionRequest } from "@kody-ade/engine-contracts";

const FLY_API_BASE = "https://api.machines.dev/v1";

const DEFAULT_APP = process.env.FLY_APP_NAME ?? "kody-runner";
const DEFAULT_IMAGE =
  process.env.FLY_RUNNER_IMAGE ?? "registry.fly.io/kody-runner:latest";
const DEFAULT_REGION = process.env.FLY_REGION ?? "fra";

/**
 * Hard ceiling on the machine-create call. The Fly Machines API normally
 * answers in a few seconds; without a bound, a hung API holds the whole
 * Vibe/start request open until the serverless runtime kills it. On timeout
 * the fetch rejects and the caller's catch returns 500 fast.
 */
const SPAWN_TIMEOUT_MS = 30_000;
const INITIAL_START_WAIT_SECONDS = 8;
const RETRY_START_WAIT_SECONDS = 30;
const EXPLICIT_START_RETRY_MS = 150_000;
const EXPLICIT_START_RETRY_INTERVAL_MS = 3_000;

async function waitForMachineStarted(
  token: string,
  app: string,
  machineId: string,
  timeoutSeconds: number,
): Promise<boolean> {
  const url = `${FLY_API_BASE}/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}/wait?state=started&timeout=${timeoutSeconds}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout((timeoutSeconds + 5) * 1_000),
  });
  if (res.ok) return true;
  if (res.status === 408) return false;
  const body = await res.text().catch(() => "");
  throw new Error(
    `Fly Machine start wait failed ${res.status}: ${body.slice(0, 200) || res.statusText}`,
  );
}

async function ensureMachineStarted(
  token: string,
  app: string,
  machineId: string,
): Promise<void> {
  if (
    await waitForMachineStarted(
      token,
      app,
      machineId,
      INITIAL_START_WAIT_SECONDS,
    )
  ) {
    return;
  }

  const startUrl = `${FLY_API_BASE}/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}/start`;
  const retryDeadline = Date.now() + EXPLICIT_START_RETRY_MS;
  while (true) {
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
    });
    if (startRes.ok) break;

    const body = await startRes.text().catch(() => "");
    const imageStillPreparing = startRes.status === 412;
    if (!imageStillPreparing || Date.now() >= retryDeadline) {
      throw new Error(
        `Fly Machine explicit start failed ${startRes.status}: ${body.slice(0, 200) || startRes.statusText}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, EXPLICIT_START_RETRY_INTERVAL_MS),
    );
  }

  if (
    !(await waitForMachineStarted(
      token,
      app,
      machineId,
      RETRY_START_WAIT_SECONDS,
    ))
  ) {
    throw new Error(
      `Fly Machine ${machineId} did not reach started state after an explicit retry`,
    );
  }
}

export interface SpawnRunnerInput {
  /** owner/name of the user's repo the engine will clone */
  repo: string;
  /** GitHub token with repo + workflow scope (the user's PAT) */
  githubToken: string;
  /** Canonical engine target/intent request. */
  runRequest: EngineExecutionRequest;
  /** Dashboard ingest URL with HMAC token appended */
  dashboardUrl?: string;
  /** Optional initial chat message; empty for interactive chat */
  initMessage?: string;
  /** Optional model override (e.g. anthropic/claude-haiku-4-5-20251001) */
  model?: string;
  /**
   * JSON blob of secrets the engine reads (mirrors GH Actions
   * `toJSON(secrets)`). For POC: pass at least the model API key.
   */
  allSecrets?: Record<string, string>;
  /** Idle exit override (ms) for chat targets */
  idleExitMs?: number;
  /** Hard cap override (ms) for chat targets */
  hardCapMs?: number;
  /**
   * Thinking level (off|low|medium|high). Set as REASONING_EFFORT env
   * var on the spawned machine so the engine's chat turn respects the
   * chat-level pick. Empty/undefined → engine uses its own default
   * (off = no thinking = cheapest path).
   */
  reasoningEffort?: string;
  /**
   * Fly Machines API token. Required — must come from the user-scoped
   * Settings (see SettingsManager). The server does NOT fall back to an
   * env var; the token has to be attributed to the authenticated user.
   */
  flyToken?: string;
  /**
   * Performance tier for the spawned Fly Machine. Maps to a fixed VM
   * shape (see PERF_GUEST). Omit to use the default ("medium").
   */
  perfTier?: PerfTier;
  /**
   * Git ref to clone (branch name or SHA). When unset, the entrypoint
   * falls back to `main`. Callers should pass the repo's actual default
   * branch when it differs from main — otherwise the runner clones a
   * stale tree and the agent's diff is rooted at the wrong base.
   */
  ref?: string;
}

export type PerfTier = "low" | "medium" | "high";

/**
 * Fly guest configurations per perf tier. Tier names + costs are
 * mirrored in the Settings UI (SettingsManager.tsx FLY_PERF_LABELS) so
 * users can pick by tradeoff. Cost approximations are per 30-min session.
 *   low    — shared-cpu-2x / 2GB  (~$0.005)  chat-only, light tools
 *   medium — performance-1x / 2GB (~$0.05)   vibe coding (default)
 *   high   — performance-2x / 4GB (~$0.11)   heavy installs / parallel tests
 */
const PERF_GUEST: Record<
  PerfTier,
  {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  }
> = {
  low: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
  medium: { cpu_kind: "performance", cpus: 1, memory_mb: 2048 },
  high: { cpu_kind: "performance", cpus: 2, memory_mb: 4096 },
};

const DEFAULT_PERF_TIER: PerfTier = "medium";

export interface SpawnRunnerResult {
  machineId: string;
  app: string;
  region: string;
}

function requireFlyToken(explicit?: string): string {
  const token = (explicit ?? "").trim();
  if (!token) {
    throw new Error(
      "Fly runner not configured: save a token via Settings → Fly Runner. " +
        "The dashboard does not fall back to server env vars — the token " +
        "must come from the authenticated user.",
    );
  }
  return token;
}

/**
 * Build the env array for the Fly Machine. Keys here match what the
 * kody-runner image's entrypoint.sh expects.
 */
function buildMachineEnv(input: SpawnRunnerInput): Record<string, string> {
  const env: Record<string, string> = {
    REPO: input.repo,
    GITHUB_TOKEN: input.githubToken,
    KODY_RUN_REQUEST_JSON: JSON.stringify(input.runRequest),
  };
  if (input.initMessage) env.INIT_MESSAGE = input.initMessage;
  if (input.model) env.MODEL = input.model;
  if (input.dashboardUrl) env.DASHBOARD_URL = input.dashboardUrl;
  if (input.idleExitMs) env.KODY_IDLE_EXIT_MS = String(input.idleExitMs);
  if (input.hardCapMs) env.KODY_HARD_CAP_MS = String(input.hardCapMs);
  if (input.reasoningEffort) env.REASONING_EFFORT = input.reasoningEffort;
  if (input.ref) env.REF = input.ref;
  if (input.allSecrets) {
    env.ALL_SECRETS = JSON.stringify(input.allSecrets);
  }
  return env;
}

/**
 * POST /apps/{app}/machines — create + start a new Machine that runs the
 * runner image once and exits. The image's ENTRYPOINT is the engine's
 * entrypoint.sh; no command override needed.
 */
export async function spawnRunner(
  input: SpawnRunnerInput,
): Promise<SpawnRunnerResult> {
  const token = requireFlyToken(input.flyToken);
  const app = DEFAULT_APP;
  const region = DEFAULT_REGION;
  const image = DEFAULT_IMAGE;

  // VM shape comes from the user-selected perf tier (Settings → Fly
  // Runner). Default is "medium" (performance-1x / 2GB) — the sweet
  // spot for vibe coding. See PERF_GUEST for the full mapping.
  const tier: PerfTier = input.perfTier ?? DEFAULT_PERF_TIER;
  const guest = PERF_GUEST[tier];

  const body = {
    config: {
      image,
      env: buildMachineEnv(input),
      auto_destroy: true,
      restart: { policy: "no" },
      guest,
    },
    region,
  };

  const url = `${FLY_API_BASE}/apps/${encodeURIComponent(app)}/machines`;
  const payload = {
    ...body,
    config: await prepareMachineSsh({
      app,
      config: body.config,
      cfg: { token, orgSlug: "personal", defaultRegion: region },
    }),
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout (AbortSignal.timeout → TimeoutError) or network failure. Surface
    // a clean message instead of a raw DOMException; the route turns it into a
    // 500 so the user gets a fast failure rather than a hung request.
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: reason, app, target: input.runRequest.target },
      "fly: spawnRunner request failed (timeout or network)",
    );
    throw new Error(`Fly Machines API request failed: ${reason}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      {
        status: res.status,
        body: text.slice(0, 500),
        app,
        target: input.runRequest.target,
      },
      "fly: spawnRunner failed",
    );
    throw new Error(
      `Fly Machines API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  const data = (await res.json()) as { id?: string; region?: string };
  if (!data.id) {
    throw new Error("Fly Machines API returned no machine id");
  }

  await ensureMachineStarted(token, app, data.id);

  logger.info(
    {
      machineId: data.id,
      app,
      region: data.region ?? region,
      target: input.runRequest.target,
      perfTier: tier,
    },
    "fly: machine spawned",
  );

  return { machineId: data.id, app, region: data.region ?? region };
}
