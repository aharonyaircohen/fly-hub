/**
 * @fileType utility
 * @domain kody
 * @pattern engine-install
 * @ai-summary One-shot engine installer for a consumer repo.
 *
 * Commits the dashboard-compatible `kody.yml` to
 * `.github/workflows/kody.yml` in the target repo, (best-effort) writes the
 * user's PAT as the
 * `KODY_TOKEN` Actions secret so the engine has GitHub auth at runtime,
 * and (best-effort) registers the dashboard webhook so push-based cache
 * invalidation works from day one. Runtime secrets remain in Kody's encrypted
 * vault; Engine reads only declared secrets through GitHub Actions OIDC.
 *
 * Idempotent: re-running on a configured repo syncs the workflow to the
 * bundled template, refreshes `KODY_TOKEN`, and refreshes the webhook
 * subscription.
 *
 * Secret writes need `repo:secrets:write` on the PAT (a normal `repo`-
 * scoped fine-grained PAT covers this). When that fails we soft-fail and
 * surface a `nextSteps` entry so the user can set the secrets manually.
 */
import type { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
import { logger } from "@kody-ade/base/logger";
import { writeGitHubFileWithRetry } from "@kody-ade/base/github-contents-write";
import {
  ensureWebhook,
  type EnsureWebhookResult,
} from "@dashboard/lib/webhooks/register";
import { readVariables } from "@kody-ade/base/variables/store";
import {
  ChatModelsSchema,
  AutomaticModelSchema,
  AUTOMATIC_MODEL_ID,
  engineAutomaticModelConfigs,
  engineRuntimeModelConfig,
  pickEngineDefaultModel,
  engineModelSpec,
  VAR_LLM_MODELS,
  VAR_LLM_AUTOMATIC,
  type AutomaticModel,
  type ChatModel,
} from "@kody-ade/base/variables/models";
import {
  getEngineConfig,
  writeEngineModelSelection,
} from "@kody-ade/base/engine/config";
import { KODY_OPENROUTER_FREE_CHAT_MODEL } from "@kody-ade/kody-chat-dashboard/chat/model-catalog";
import { KODY_ENGINE_WORKFLOW_PATH } from "./paths";
import { readVault } from "@kody-ade/base/vault/store";
import { upsertSecret } from "@kody-ade/base/vault/mutations";

export const KODY_TOKEN_SECRET = "KODY_TOKEN";

export const WORKFLOW_TEMPLATE_SOURCE =
  "https://unpkg.com/@kody-ade/kody-engine@latest/templates/kody.yml";
export const WORKFLOW_PATH = KODY_ENGINE_WORKFLOW_PATH;
const WORKFLOW_TEMPLATE_TIMEOUT_MS = 5_000;

export interface InstallEngineInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  token: string;
  hookUrl: string;
  /**
   * Re-commit the template even if the workflow already matches.
   * Default false — when the file is current, no commit happens.
   */
  force?: boolean;
  resolvePersonalSecret?: (name: string) => Promise<string | null>;
  personalModels?: ChatModel[];
}

export type WorkflowAction = "created" | "updated" | "unchanged";

export interface InstallEngineResult {
  ok: true;
  workflow: {
    action: WorkflowAction;
    path: string;
    htmlUrl: string | null;
    commitSha: string | null;
    templateSource: string;
  };
  webhook: EnsureWebhookResult;
  kodyTokenSecret: {
    ok: boolean;
    name: string;
    error?: string;
  };
  runtimeSecrets: {
    source: "kody-vault";
    authentication: "github-oidc";
    provisioned: string[];
  };
  nextSteps: string[];
  summary: string;
}

export interface InstallEngineFailure {
  ok: false;
  error: string;
}

async function loadWorkflowTemplate(): Promise<{
  content: string;
  source: string;
}> {
  const response = await fetch(WORKFLOW_TEMPLATE_SOURCE, {
    cache: "no-store",
    signal: AbortSignal.timeout(WORKFLOW_TEMPLATE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Could not load Kody workflow template (${response.status} ${response.statusText}).`,
    );
  }
  const body = await response.text();
  if (
    (!body.trim().startsWith("#") && !body.includes("name: kody")) ||
    !body.includes("requestId:") ||
    !body.includes("sessionId:") ||
    !body.includes("DASHBOARD_URL:")
  ) {
    throw new Error(
      `Kody workflow template did not look like chat-compatible kody.yml (got ${body.length} chars).`,
    );
  }
  return { content: body, source: WORKFLOW_TEMPLATE_SOURCE };
}

async function encryptForRepo(
  value: string,
  base64PublicKey: string,
): Promise<string> {
  await sodium.ready;
  const messageBytes = sodium.from_string(value);
  const keyBytes = sodium.from_base64(
    base64PublicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

/**
 * Best-effort: encrypt `value` against the repo's Actions public key and
 * upsert it as the `secretName` repo secret. Returns `{ ok: false, error }`
 * on any failure — callers should surface the error in `nextSteps` rather
 * than aborting the install.
 */
async function setRepoActionsSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: key } = await octokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    });
    const encrypted_value = await encryptForRepo(value, key.key);
    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value,
      key_id: key.key_id,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "set_repo_secret_failed",
    };
  }
}

async function readExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ sha: string; content: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: WORKFLOW_PATH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    return {
      sha: data.sha,
      content: Buffer.from(data.content, "base64").toString("utf-8"),
    };
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err &&
      "status" in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

async function readChatModels(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ChatModel[]> {
  try {
    const { doc } = await readVariables(owner, repo, { force: true });
    const raw = doc.variables[VAR_LLM_MODELS]?.value;
    if (!raw) return [];
    return ChatModelsSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    logger.warn({ err, owner, repo }, "install: failed to read chat models");
    return [];
  }
}

async function readAutomaticModel(
  owner: string,
  repo: string,
): Promise<AutomaticModel> {
  try {
    const { doc } = await readVariables(owner, repo, { force: true });
    const raw = doc.variables[VAR_LLM_AUTOMATIC]?.value;
    return raw
      ? AutomaticModelSchema.parse(JSON.parse(raw))
      : AutomaticModelSchema.parse({});
  } catch {
    return AutomaticModelSchema.parse({});
  }
}

export async function installEngine(
  input: InstallEngineInput,
): Promise<InstallEngineResult | InstallEngineFailure> {
  const {
    octokit,
    owner,
    repo,
    token,
    hookUrl,
    force,
    resolvePersonalSecret,
    personalModels = [],
  } = input;

  try {
    const existing = await readExisting(octokit, owner, repo);
    let template: string;
    let templateSource: string;
    try {
      const remote = await loadWorkflowTemplate();
      template = remote.content;
      templateSource = remote.source;
    } catch (err) {
      if (!existing) throw err;
      template = existing.content;
      templateSource = `repository:${WORKFLOW_PATH}`;
      logger.warn(
        { err, owner, repo },
        "installEngine: remote workflow template unavailable; using existing repository workflow",
      );
    }

    let workflowAction: WorkflowAction = "unchanged";
    let workflowCommitSha: string | null = null;
    let workflowHtmlUrl: string | null = null;

    if (!existing) {
      const data = await writeGitHubFileWithRetry(octokit, {
        owner,
        repo,
        path: WORKFLOW_PATH,
        message: "chore(kody): install engine workflow",
        content: Buffer.from(template, "utf-8").toString("base64"),
      });
      workflowAction = "created";
      workflowCommitSha = data.commitSha;
      workflowHtmlUrl = data.htmlUrl;
    } else if (existing.content === template && !force) {
      workflowAction = "unchanged";
      workflowHtmlUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${WORKFLOW_PATH}`;
    } else {
      const data = await writeGitHubFileWithRetry(octokit, {
        owner,
        repo,
        path: WORKFLOW_PATH,
        message: "chore(kody): sync engine workflow to latest template",
        content: Buffer.from(template, "utf-8").toString("base64"),
        sha: existing.sha,
      });
      workflowAction = "updated";
      workflowCommitSha = data.commitSha;
      workflowHtmlUrl = data.htmlUrl;
    }

    // Write the engine model into kody.config.json (`agent.model` — the key
    // the engine actually reads), preserving any hand-authored config. Always
    // writes a baseline (github + agent when available) even when no model is
    // configured yet, so the file exists for the engine to extend.
    const repositoryModels = await readChatModels(octokit, owner, repo);
    const models =
      repositoryModels.length > 0 ? repositoryModels : personalModels;
    const automatic = await readAutomaticModel(owner, repo);
    const engineModel = pickEngineDefaultModel(models);
    const { config: existingConfig } = await getEngineConfig(
      octokit,
      owner,
      repo,
      { force: true },
    );
    const existingModel = existingConfig.agent?.model;
    await writeEngineModelSelection(octokit, owner, repo, {
      modelSpec: automatic.engineDefault
        ? AUTOMATIC_MODEL_ID
        : engineModel
          ? engineModelSpec(engineModel)
          : existingModel
            ? null
            : engineModelSpec(KODY_OPENROUTER_FREE_CHAT_MODEL),
      modelConfig:
        !automatic.engineDefault && engineModel
          ? engineRuntimeModelConfig(engineModel)
          : undefined,
      automaticModels: engineAutomaticModelConfigs(models),
    });

    const requiredModelSecrets = [
      ...(engineModel?.apiKeySecret ? [engineModel.apiKeySecret] : []),
      ...models
        .filter((model) => automatic.engineDefault && model.automatic === true)
        .map((model) => model.apiKeySecret),
    ].filter((name, index, names) => name && names.indexOf(name) === index);
    const provisionedRuntimeSecrets: string[] = [];
    if (resolvePersonalSecret && requiredModelSecrets.length > 0) {
      const { doc } = await readVault(octokit, owner, repo, { force: true });
      for (const name of requiredModelSecrets) {
        if (doc.secrets[name]?.value) continue;
        const value = await resolvePersonalSecret(name);
        if (!value) continue;
        await upsertSecret({
          octokit,
          owner,
          repo,
          name,
          value,
          actorLogin: "kody-init",
        });
        provisionedRuntimeSecrets.push(name);
      }
    }

    const kodyTokenResult = await setRepoActionsSecret(
      octokit,
      owner,
      repo,
      KODY_TOKEN_SECRET,
      token,
    );
    const kodyTokenSecret: InstallEngineResult["kodyTokenSecret"] =
      kodyTokenResult.ok
        ? { ok: true, name: KODY_TOKEN_SECRET }
        : {
            ok: false,
            name: KODY_TOKEN_SECRET,
            error: kodyTokenResult.error,
          };

    let webhook: InstallEngineResult["webhook"];
    try {
      const result = await ensureWebhook({ token, owner, repo, hookUrl });
      webhook = result;
    } catch (err) {
      webhook = {
        ok: false,
        error: err instanceof Error ? err.message : "webhook_register_failed",
      };
    }

    logger.info(
      {
        owner,
        repo,
        workflowAction,
        workflowCommitSha,
        webhookOk: webhook.ok,
        kodyTokenSecretOk: kodyTokenSecret.ok,
        runtimeSecretSource: "kody-vault",
        runtimeSecretAuthentication: "github-oidc",
      },
      "installEngine: installed engine workflow",
    );

    const nextSteps = [
      'Pick "Kody Live" (or "Kody Live Fly") in the chat agent dropdown to ' +
        "verify the workflow runs. First dispatch cold-starts in ~30s.",
    ];
    if (!kodyTokenSecret.ok) {
      nextSteps.unshift(
        `Couldn't auto-set the \`${KODY_TOKEN_SECRET}\` Actions secret ` +
          `(${kodyTokenSecret.error ?? "unknown error"}). The PAT used here ` +
          "likely lacks `repo:secrets:write`. Without it the engine has no " +
          "GitHub auth at runtime — labels, comments and PR updates will fail. " +
          "Either re-mint the PAT with secrets write access and re-run /init, " +
          `or add the secret by hand: ` +
          `https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      );
    }
    if (!webhook.ok) {
      if (webhook.skipped) {
        nextSteps.push(
          "Webhook setup was skipped because the dashboard has no public HTTPS URL. " +
            "Set NEXT_PUBLIC_SERVER_URL to the deployed dashboard URL, then re-run /init.",
        );
      } else if (webhook.status === 403 || webhook.status === 404) {
        nextSteps.push(
          "GitHub denied the webhook update. Give the PAT Webhooks: write permission " +
            "(or admin:repo_hook for a classic PAT), then re-run /init.",
        );
      } else {
        nextSteps.push(
          `Webhook setup failed (${webhook.detail ?? webhook.error}). Re-run /init after correcting the dashboard URL or PAT permissions.`,
        );
      }
    }

    const tokenSummary = kodyTokenSecret.ok
      ? `${KODY_TOKEN_SECRET} secret ${workflowAction === "created" ? "set" : "refreshed"}.`
      : `${KODY_TOKEN_SECRET} secret FAILED — ${kodyTokenSecret.error ?? "unknown"}.`;
    const vaultSummary =
      "Runtime secrets stay in Kody vault and use GitHub OIDC.";
    const webhookSummary = webhook.ok
      ? `Webhook ${webhook.created ? "registered" : "refreshed"}.`
      : webhook.skipped
        ? "Webhook skipped — configure a public HTTPS dashboard URL."
        : `Webhook FAILED — ${webhook.detail ?? webhook.error}${webhook.status ? ` (HTTP ${webhook.status})` : ""}.`;
    const workflowSummary =
      workflowAction === "created"
        ? `Engine workflow created at ${WORKFLOW_PATH}.`
        : workflowAction === "updated"
          ? "Engine workflow updated to the bundled template."
          : "Engine workflow already matches the bundled template — no commit needed.";
    const summary = `${workflowSummary} ${tokenSummary} ${vaultSummary} ${webhookSummary}`;

    return {
      ok: true,
      workflow: {
        action: workflowAction,
        path: WORKFLOW_PATH,
        htmlUrl: workflowHtmlUrl,
        commitSha: workflowCommitSha,
        templateSource,
      },
      webhook,
      kodyTokenSecret,
      runtimeSecrets: {
        source: "kody-vault",
        authentication: "github-oidc",
        provisioned: provisionedRuntimeSecrets,
      },
      nextSteps,
      summary,
    };
  } catch (err) {
    logger.warn({ err, owner, repo }, "installEngine failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "install_engine_failed",
    };
  }
}
