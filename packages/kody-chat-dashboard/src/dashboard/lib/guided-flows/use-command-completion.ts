"use client";

import { useEffect } from "react";

import { isRenderedViewDirective } from "../chat-ui-actions";
import type { Message } from "../components/kody-chat-types";
import { authHeaders } from "../kody-chat-live-session";

export function useGuidedFlowCommandCompletion({
  messages,
  setMessages,
}: {
  messages: readonly Message[];
  setMessages: (updater: (previous: Message[]) => Message[]) => void;
}): void {
  useEffect(() => {
    const pendingMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          isRenderedViewDirective(message.view) &&
          message.view.resultTarget === "guided-flow" &&
          message.view.guidedFlow &&
          message.view.data.status === "running",
      );
    const pendingView = pendingMessage?.view;
    if (!isRenderedViewDirective(pendingView) || !pendingView.guidedFlow) return;

    let cancelled = false;
    const poll = () => {
      void fetch("/api/kody/guided-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          action: "sync-command",
          instanceId: pendingView.guidedFlow?.instanceId,
          expectedRevision: pendingView.guidedFlow?.revision,
          mutationId: `sync:${pendingView.guidedFlow?.instanceId}:${pendingView.guidedFlow?.revision}:${Date.now()}`,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("workflow_status_unavailable");
          return (await response.json()) as { view?: unknown };
        })
        .then((payload) => {
          if (cancelled || !isRenderedViewDirective(payload.view)) return;
          if (payload.view.data.status === "running") return;
          const nextView = payload.view;
          setMessages((previous) =>
            previous.map((message) =>
              message.view?.id === pendingView.id
                ? { ...message, view: nextView }
                : message,
            ),
          );
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(poll, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [messages, setMessages]);
}
