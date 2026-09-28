/**
 * @fileType page
 * @domain kody
 * @pattern workflow-selected-page
 * @ai-summary Selected workflow route. Keeps workflow selection addressable at
 *   `/workflows/<id>`.
 */

import { WorkflowsManager } from "@dashboard/features/workflows/components/WorkflowsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Workflow - Kody Operations Dashboard",
  description: "View a selected Kody workflow definition.",
  path: "/workflows",
});

export default async function SelectedWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowsManager selectedId={id} />;
}
