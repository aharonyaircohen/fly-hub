/** Themes page-plugin for the chat-first shell. */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const THEMES_PLUGIN_ID = "themes";
export const THEMES_PANEL_ID = "themes";

export const themesChatPlugin: ChatPlugin = {
  id: THEMES_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: THEMES_PANEL_ID,
      title: "Client Themes",
      render: createLazyPanel("themes", () =>
        import("./panel").then((module) => ({
          default: module.ThemesPanelView,
        })),
      ),
    },
  ],
};
