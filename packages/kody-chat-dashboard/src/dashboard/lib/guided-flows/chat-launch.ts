import type { Message } from "../components/kody-chat-types";

const GUIDED_FLOW_MESSAGE_CONTENT = new Set([
  "GuidedFlow started. Follow the steps below.",
  "GuidedFlow resumed. Continue where you stopped.",
  "Continue with the next step below.",
  "GuidedFlow completed.",
  "GuidedFlow cancelled.",
]);

export function shouldAutoResumeGuidedFlows(input: {
  hydrated: boolean;
  activeSessionId: string | null | undefined;
  lockedAgentSlug: string | null | undefined;
  messageCount: number;
  guidedFlowRequest: unknown;
}): boolean {
  return (
    input.hydrated &&
    Boolean(input.activeSessionId) &&
    !input.lockedAgentSlug &&
    input.messageCount === 0 &&
    input.guidedFlowRequest == null
  );
}

export function guidedFlowMessageId(message: Message): string | undefined {
  return message.view ? `guided-flow:${message.view.id}` : undefined;
}

export function isGuidedFlowChatMessage(
  message: Pick<Message, "content" | "view">,
): boolean {
  return (
    message.view?.resultTarget === "guided-flow" ||
    GUIDED_FLOW_MESSAGE_CONTENT.has(message.content)
  );
}

export function replaceGuidedFlowChatMessage(
  previous: readonly Message[],
  message: Message,
): Message[] {
  return [
    ...previous.filter((candidate) => !isGuidedFlowChatMessage(candidate)),
    message,
  ];
}

export function locationAfterGuidedFlowLaunch(
  pathname: string,
  search: string,
): string {
  const params = new URLSearchParams(search);

  if (
    !params.has("guidedFlowInstanceId") &&
    params.get("guidedFlowOnce") !== "1"
  ) {
    return `${pathname}${search}`;
  }

  params.delete("guidedFlowInstanceId");
  params.delete("guidedFlow");
  params.delete("instanceKey");
  params.delete("guidedFlowOnce");

  const remainingSearch = params.toString();
  return remainingSearch ? `${pathname}?${remainingSearch}` : pathname;
}
