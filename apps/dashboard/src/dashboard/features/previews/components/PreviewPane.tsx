/**
 * @fileType component
 * @domain preview
 * @pattern preview-pane
 * @ai-summary Compatibility wrapper for the shared PreviewBrowser. Legacy
 * callers can keep using PreviewPane while browser behavior lives in one
 * component.
 */
"use client";

import { PreviewBrowser, type PreviewBrowserProps } from "@dashboard/features/previews/components/PreviewBrowser";

export type PreviewPaneProps = PreviewBrowserProps;

export function PreviewPane(props: PreviewPaneProps) {
  return <PreviewBrowser {...props} />;
}
