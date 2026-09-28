import type { GuidedFlowReader } from "@kody-ade/kody-chat-dashboard/guided-flows/reader";

function pointer(
  value: Readonly<{
    flowId: string;
    flowVersion: number;
    currentStepId: string;
  }>,
): string {
  return `${value.flowId}@${value.flowVersion} / ${value.currentStepId}`;
}

export async function buildGuidedFlowTurnContext(
  reader: GuidedFlowReader,
): Promise<string | null> {
  const current = await reader.getCurrent();
  if (!current) return null;
  const path = [...current.path, current.instance].map(pointer).join("\n");
  const guides = await reader.getModelGuides([current.definition]);
  const guide = guides[0] ? `\n\nCurrent Blueprint guide:\n${guides[0]}` : "";
  return `## Active Guided Flow

This conversation is bound to GuidedFlow instance ${current.instance.instanceId}.
Status: ${current.instance.status}
Revision: ${current.instance.revision}
Current: ${pointer(current.instance)}
Path:
${path}

Call \`guided_flow_context\` with no arguments before answering any question about the current flow, step, or previous answers. Use \`guided_flow_read\` only for deeper definition, data, or history queries. Treat both as read-only context. Never infer or modify GuidedFlow progress from chat text.${guide}`;
}
