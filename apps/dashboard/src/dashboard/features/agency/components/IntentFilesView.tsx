import { INTENTS_DEFINITION } from "@dashboard/lib/agent-guidance-definitions";
import { AgentGuidanceFilesView } from "@dashboard/lib/components/AgentGuidanceFilesView";

export function IntentFilesView({
  initialPath = "",
}: {
  initialPath?: string;
}) {
  return (
    <AgentGuidanceFilesView
      definition={INTENTS_DEFINITION}
      initialPath={initialPath}
    />
  );
}
