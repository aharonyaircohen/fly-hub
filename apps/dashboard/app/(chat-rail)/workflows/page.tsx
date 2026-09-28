/**
 * @fileType page
 * @domain kody
 * @pattern workflows-page
 * @ai-summary Workflow definitions page for ordered capability queues.
 */

import { WorkflowsManager } from "@dashboard/features/workflows/components/WorkflowsManager";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Workflows - Kody Operations Dashboard",
  description: "Manage workflow definitions built from capability queues.",
  path: "/workflows",
});

export default function WorkflowsPage() {
  return <WorkflowsManager />;
}
