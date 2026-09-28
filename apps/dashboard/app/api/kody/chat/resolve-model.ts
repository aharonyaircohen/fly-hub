import { NextRequest } from "next/server";
import {
  resolveChatModel as resolvePackageChatModel,
  type ResolveChatModelOptions,
} from "@kody-ade/kody-chat-dashboard/chat/resolve-model";
import "@dashboard/lib/chat/personal-model-settings";

export type { ResolvedChatModel, ResolveChatModelOptions } from "@kody-ade/kody-chat-dashboard/chat/resolve-model";

export async function resolveChatModel(
  request: NextRequest,
  modelId?: string,
  options: ResolveChatModelOptions = {},
) {
  return resolvePackageChatModel(request, modelId, options);
}
