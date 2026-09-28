import type { ViewerOptions } from "@file-viewer/react";
import { archiveRenderer } from "@file-viewer/renderer-archive";
import { presentationRenderer } from "@file-viewer/renderer-presentation";
import { wordRenderer } from "@file-viewer/renderer-word";
import { spreadsheetRenderer } from "@file-viewer/renderer-spreadsheet";
import type { AdvancedFileRenderer } from "./advanced-file-preview";

type ViewerRendererInput = NonNullable<ViewerOptions["renderers"]>;

// Flyfish's Word renderer narrows its host to HTMLDivElement while the React
// package declares HTMLElement. Runtime behavior is compatible; contain the
// upstream generic mismatch at this third-party boundary.
const FLYFISH_RENDERERS: Readonly<
  Record<AdvancedFileRenderer, ViewerRendererInput>
> = {
  archive: archiveRenderer as unknown as ViewerRendererInput,
  presentation: presentationRenderer as unknown as ViewerRendererInput,
  word: wordRenderer as unknown as ViewerRendererInput,
  spreadsheet: spreadsheetRenderer as unknown as ViewerRendererInput,
};

export function flyfishRenderer(
  renderer: AdvancedFileRenderer,
): ViewerRendererInput {
  return FLYFISH_RENDERERS[renderer];
}
