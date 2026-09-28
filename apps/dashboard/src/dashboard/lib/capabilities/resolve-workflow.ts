import {
  findMissingCapabilitySlugs,
  readResolvedCapabilityFile,
  type CapabilityDetail,
} from "@kody-ade/agency/capabilities";
import type {
  WorkflowDefinition,
  WorkflowValidationIssue,
} from "@dashboard/lib/workflow-definitions";
import type { Octokit } from "@octokit/rest";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";

function referencedCapabilities(workflow: WorkflowDefinition): string[] {
  return [
    ...workflow.capabilities,
    ...(workflow.steps ?? []).map((step) => step.capability),
  ];
}

export async function resolveWorkflowCapabilities(
  workflow: WorkflowDefinition,
  options: {
    octokit: Octokit;
    activeStoreSlugs?: ReadonlySet<string>;
    builtInSlugs?: ReadonlySet<string>;
    tenantId?: string;
  },
): Promise<CapabilityDetail[]> {
  const slugs = [...new Set(referencedCapabilities(workflow))];
  const capabilities = await Promise.all(
    slugs.map((slug) =>
      options.builtInSlugs?.has(slug)
        ? Promise.resolve(null)
        : readResolvedCapabilityFile(slug, options.octokit, options),
    ),
  );
  return capabilities.filter((capability): capability is CapabilityDetail =>
    Boolean(capability),
  );
}

export async function unresolvedWorkflowCapabilityIssues(
  workflow: WorkflowDefinition,
  options: {
    octokit: Octokit;
    activeStoreSlugs?: ReadonlySet<string>;
    builtInSlugs?: ReadonlySet<string>;
    tenantId?: string;
  },
): Promise<WorkflowValidationIssue[]> {
  const missing = new Set(
    await findMissingCapabilitySlugs(referencedCapabilities(workflow), {
      ...options,
      builtInSlugs: options.builtInSlugs ?? ENGINE_BUILT_IN_CAPABILITIES,
    }),
  );
  const issues: WorkflowValidationIssue[] = [];
  workflow.capabilities.forEach((slug, index) => {
    if (missing.has(slug)) {
      issues.push({
        code: "unknown_capability",
        path: `capabilities[${index}]`,
        message: `workflow capability ${slug} could not be resolved from the connected backend or active Store`,
      });
    }
  });
  workflow.steps?.forEach((step, index) => {
    if (missing.has(step.capability)) {
      issues.push({
        code: "unknown_capability",
        path: `steps[${index}].capability`,
        message: `workflow step references capability ${step.capability}, but it could not be resolved from the connected backend or active Store`,
      });
    }
  });
  return issues;
}

export function workflowValidationMessage(
  issues: readonly WorkflowValidationIssue[],
): string {
  const details = [...new Set(issues.map((issue) => issue.message.trim()))]
    .filter(Boolean)
    .join(" ");
  return details
    ? `Workflow is not safe to save: ${details}`
    : "Workflow is not safe to save.";
}
