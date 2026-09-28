import "server-only";

import { getPersonalBrainServices } from "./personal-services";
import {
  BrainChatModelsSchema,
  normalizeBrainChatModels,
  type BrainChatModel,
} from "./chat-models";

export async function readBrainChatModels(
  _login?: string,
): Promise<BrainChatModel[]> {
  const services = getPersonalBrainServices();
  const user = await services.resolveUser();
  if (!user) return [];
  const value = await services.loadState(user.id, "models");
  const parsed = BrainChatModelsSchema.safeParse(value);
  return parsed.success ? normalizeBrainChatModels(parsed.data) : [];
}

export async function writeBrainChatModels(
  _login: string,
  models: BrainChatModel[],
): Promise<BrainChatModel[]> {
  const normalized = normalizeBrainChatModels(
    BrainChatModelsSchema.parse(models),
  );
  const services = getPersonalBrainServices();
  const user = await services.resolveUser();
  if (!user) throw new Error("unauthorized");
  await services.saveState(user.id, "models", normalized);
  return normalized;
}
