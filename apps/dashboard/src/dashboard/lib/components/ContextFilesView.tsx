/** Context is the factual member of the shared agent-guidance workspace. */
"use client";

import { CONTEXT_DEFINITION } from "../agent-guidance-definitions";
import { AgentGuidanceFilesView } from "./AgentGuidanceFilesView";

export function ContextFilesView({ initialPath = "" }: { initialPath?: string }) {
  return (
    <AgentGuidanceFilesView
      definition={CONTEXT_DEFINITION}
      initialPath={initialPath}
    />
  );
}
