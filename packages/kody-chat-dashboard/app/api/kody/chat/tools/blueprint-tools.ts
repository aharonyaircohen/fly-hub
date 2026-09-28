import { tool } from "ai";
import { z } from "zod";

interface Ctx {
  getBlueprintStatus(): Promise<unknown>;
}

export function createBlueprintTools(ctx: Ctx) {
  return {
    get_blueprint_status: tool({
      description:
        "Check which Store Blueprints are installed in the current repository and whether their maintainers are active. Use this for natural questions about installed, applied, active, or maintaining Blueprints; never infer Blueprint status from the workflow list.",
      inputSchema: z.object({}),
      execute: async () => ctx.getBlueprintStatus(),
    }),
  };
}
