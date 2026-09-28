/**
 * @fileType module
 * @domain chat-plugin-languages
 * @pattern plugin-manifest
 * @ai-summary Languages page-plugin. Contributes exactly one panel view for
 *   the flipped chat-first shell; the route keeps rendering the same manager.
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const LANGUAGES_PLUGIN_ID = "languages";
export const LANGUAGES_PANEL_ID = "languages";

export const languagesChatPlugin: ChatPlugin = {
  id: LANGUAGES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: LANGUAGES_PANEL_ID,
      title: "Languages",
      render: createLazyPanel("languages", () =>
        import("./panel").then((m) => ({ default: m.LanguagesPanelView })),
      ),
    },
  ],
};
