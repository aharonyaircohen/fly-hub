import { AgentGuidanceFilesView } from "@dashboard/lib/components/AgentGuidanceFilesView";
import { POLICIES_DEFINITION } from "@dashboard/lib/agent-guidance-definitions";

export const dynamic = "force-dynamic";

export default async function PolicyPathPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join("/");
  return <AgentGuidanceFilesView definition={POLICIES_DEFINITION} initialPath={joined.endsWith(".md") ? joined : `${joined}.md`} />;
}
