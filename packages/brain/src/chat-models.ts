import { z } from "zod";

const BrainChatModelSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  runtime: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
  default: z.boolean().default(false),
});

export const BrainChatModelsSchema = z.array(BrainChatModelSchema).max(50);
export type BrainChatModel = z.infer<typeof BrainChatModelSchema>;

export function normalizeBrainChatModels(
  models: BrainChatModel[],
): BrainChatModel[] {
  let foundDefault = false;
  return models.map((model) => {
    const isDefault = model.default && !foundDefault;
    if (isDefault) foundDefault = true;
    return { ...model, default: isDefault };
  });
}
