"use client";

import type { DragEventHandler, HTMLAttributes, ReactNode } from "react";

export interface KodyChatFrameProps {
  rootClassName?: string;
  contentClassName?: string;
  testId?: string;
  dragOverlay?: ReactNode;
  sessionsPanel?: ReactNode;
  voiceOverlay?: ReactNode;
  header?: ReactNode;
  notice?: ReactNode;
  messages: ReactNode;
  composer: ReactNode;
  footer?: ReactNode;
  dialogs?: ReactNode;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  rootProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">;
}

/**
 * Shared structural frame used by both the embeddable chat and Kody's
 * Dashboard adapter. Product controls arrive as slots; the public package
 * does not import host routes, credentials, tools, or storage.
 */
export function KodyChatFrame({
  rootClassName,
  contentClassName,
  testId = "kody-chat-frame",
  dragOverlay,
  sessionsPanel,
  voiceOverlay,
  header,
  notice,
  messages,
  composer,
  footer,
  dialogs,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  rootProps,
}: KodyChatFrameProps) {
  return (
    <div
      {...rootProps}
      data-testid={testId}
      className={rootClassName}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOverlay}
      {sessionsPanel}
      <div className={contentClassName}>
        {voiceOverlay}
        {header}
        {notice}
        {messages}
        {composer}
        {footer}
        {dialogs}
      </div>
    </div>
  );
}
