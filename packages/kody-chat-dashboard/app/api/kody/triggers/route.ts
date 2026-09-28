/**
 * @fileType api-endpoint
 * @domain triggers
 * @pattern backend-crud-api
 * @ai-summary Lists and upserts the brand's trigger rules stored at
 *   `triggers/config.json` in the Kody backend. Admin (operator PAT)
 *   only; mutations are audited.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { isSystemEventName } from "@kody-ade/base/events";
import {
  getTriggers,
  mutateTriggers,
  triggerConfigSchema,
} from "@kody-ade/base/triggers";
import { recordAudit } from "../../../../src/dashboard/lib/activity/audit";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@kody-ade/base/github/core";
import { readTrust } from "@kody-ade/agency/cto/trust-store";
import {
  automationEligibilityForSubject,
  trustSubjectKey,
} from "@kody-ade/agency/cto/trust-state";
import { normalizeWorkflowDefinition } from "../../../../src/dashboard/lib/workflow-definitions";
import { normalizePipelineDefinition } from "../../../../src/dashboard/lib/pipeline-definitions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const saveSchema = z.object({ trigger: triggerConfigSchema });

export async function GET(req: NextRequest) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const { auth, octokit } = access;
  // Read fresh: the admin API and the trigger sink run in separate server
  // bundles with independent module caches, so a cached list here can lag a
  // write made through the (separately-bundled) POST route.
  const triggers = await getTriggers(octokit, auth.owner, auth.repo, {
    cache: false,
  });
  return NextResponse.json({ triggers }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const { auth, octokit } = access;

  let trigger: z.infer<typeof saveSchema>["trigger"];
  try {
    trigger = saveSchema.parse(await req.json()).trigger;
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_trigger", detail: String(error) },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!isSystemEventName(trigger.event)) {
    return NextResponse.json(
      { error: "unknown_event", detail: trigger.event },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (trigger.action.type === "start-workflow") {
    const workflowRecord = (await createBackendClient().query(
      api.workflows.get,
      {
        tenantId: `${auth.owner}/${auth.repo}`,
        workflowId: trigger.action.workflowId,
      },
    )) as { definition?: unknown } | null;
    const workflow = normalizeWorkflowDefinition(workflowRecord?.definition);
    if (!workflow) {
      return NextResponse.json(
        { error: "workflow_not_found" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    setGitHubContext(auth.owner, auth.repo, auth.token);
    try {
      const eligibility = automationEligibilityForSubject(
        await readTrust(),
        trustSubjectKey("workflow", trigger.action.workflowId),
        workflow.runWithoutApproval === true,
      );
      if (!eligibility.eligible) {
        return NextResponse.json(
          {
            error: "workflow_not_automation_eligible",
            reason: eligibility.reason,
          },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
    } finally {
      clearGitHubContext();
    }
  }
  if (trigger.action.type === "start-pipeline") {
    const pipelineRecord = (await createBackendClient().query(
      api.pipelines.get,
      {
        tenantId: `${auth.owner}/${auth.repo}`,
        pipelineId: trigger.action.pipelineId,
      },
    )) as { definition?: unknown } | null;
    const pipeline = normalizePipelineDefinition(pipelineRecord?.definition);
    if (!pipeline) {
      return NextResponse.json(
        { error: "pipeline_not_found" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    setGitHubContext(auth.owner, auth.repo, auth.token);
    try {
      const eligibility = automationEligibilityForSubject(
        await readTrust(),
        trustSubjectKey("pipeline", trigger.action.pipelineId),
        pipeline.runWithoutApproval === true,
      );
      if (!eligibility.eligible) {
        return NextResponse.json(
          { error: "pipeline_not_automation_eligible", reason: eligibility.reason },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
    } finally {
      clearGitHubContext();
    }
  }

  await mutateTriggers(octokit, auth.owner, auth.repo, (existing) => [
    ...existing.filter((candidate) => candidate.id !== trigger.id),
    trigger,
  ]);
  recordAudit(req, {
    action: "trigger.save",
    resource: trigger.id,
    detail:
      trigger.action.type === "start-workflow"
        ? `${trigger.event} → workflow:${trigger.action.workflowId}`
        : trigger.action.type === "start-pipeline"
          ? `${trigger.event} → pipeline:${trigger.action.pipelineId}`
          : `${trigger.event} → state:${trigger.action.namespace}`,
  });
  return NextResponse.json({ trigger }, { headers: NO_STORE_HEADERS });
}
