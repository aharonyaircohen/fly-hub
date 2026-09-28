/**
 * @fileType module
 * @domain chat-plugin-brands
 * @pattern plugin-manifest
 * @ai-summary Brands page-plugin. Contributes exactly one panel view for the
 *   flipped chat-first shell; the route keeps rendering the same manager.
 */
import { createLazyPanel, type ChatPlugin } from "../../platform";

export const BRANDS_PLUGIN_ID = "brands";
export const BRANDS_PANEL_ID = "brands";

export const brandsChatPlugin: ChatPlugin = {
  id: BRANDS_PLUGIN_ID,
  capabilities: ["panels"],
  panels: [
    {
      id: BRANDS_PANEL_ID,
      title: "Brands",
      render: createLazyPanel("brands", () =>
        import("./panel").then((m) => ({ default: m.BrandsPanelView })),
      ),
    },
  ],
};
