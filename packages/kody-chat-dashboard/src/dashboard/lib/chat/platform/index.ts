/**
 * @fileType module
 * @domain chat-platform
 * @pattern public-api
 * @ai-summary Public surface of the chat platform layer. Surfaces and
 *   plugins import from here; core never does (lint-enforced zones in
 *   eslint.config.mjs).
 */

export { createLazyPanel } from "./lazy-panel";
export {
  createChatInputDispatcher,
  type ChatInputDispatchResult,
  type ChatOperationRegistration,
} from "./input-dispatcher";
export {
  ChatOperationRequestError,
  requestChatOperation,
  type ChatOperationRequestResult,
} from "./operation-client";
export {
  CHAT_CAPABILITIES,
  CONTRIBUTION_CAPABILITIES,
  FULL_GRANT,
  isGranted,
  type ChatCapability,
  type ChatCapabilityGrant,
} from "./capabilities";
export {
  getChatLiveTransport,
  registerChatLiveTransport,
  resetChatLiveTransportForTests,
  type ChatLiveTransport,
  type ChatLiveTransportEvent,
} from "./live-transport";
export {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
  type ChatPluginRegistry,
  type ChatSendOutcome,
} from "./registry";
export type {
  ChatDisplayMode,
  ChatHostEffect,
  ChatPanelView,
  ChatPanelViewProps,
  ChatPlugin,
  ChatSendMiddleware,
  ChatSendMiddlewareContext,
  ChatSendMiddlewareResult,
  ChatSessionStateSpec,
  ChatSlotContribution,
  ChatSlotId,
  ChatSlotProps,
  ChatThemeContribution,
} from "./types";
export type {
  ChatAttachmentRef,
  ChatDirective,
  ChatEvent,
  ChatTransport,
  ChatTransportContext,
  ChatTransportStatus,
  ChatTurnInput,
} from "./transport";
export {
  DASHBOARD_HOST_TOOL_NAMES,
  type DashboardHostToolName,
} from "./host-tool-contract";
export {
  ChatToolRegistrationError,
  createChatServerToolRegistry,
  type ChatPluginServerTools,
  type ChatPluginToolDefinition,
  type ChatServerToolRegistry,
  type ChatToolServerContext,
} from "./tools";
export {
  CHAT_TRACE_CAPACITY,
  createChatTraceBuffer,
  readChatTrace,
  trace,
  type ChatTraceBuffer,
  type ChatTraceEntry,
  type ChatTraceEvent,
} from "./trace";
export {
  ChatCatalogCollisionError,
  createChatCatalog,
  directionForLocale,
  type ChatMessageCatalog,
  type ChatTextDirection,
} from "./i18n";
