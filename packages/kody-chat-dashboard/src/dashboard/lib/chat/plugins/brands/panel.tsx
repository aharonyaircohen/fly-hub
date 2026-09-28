/**
 * @fileType component
 * @domain chat-plugin-brands
 * @pattern page-plugin-panel
 * @ai-summary Brands panel view. Renders the SAME tree the route renders.
 *   The wrapper is only a stable marker for the flipped shell and adds no
 *   layout.
 */
"use client";

import { BrandsManager } from "../../../components/BrandsManager";

export const BRANDS_PANEL_TESTID = "chat-panel-brands";

export function BrandsPanelView() {
  return (
    <div data-testid={BRANDS_PANEL_TESTID} className="contents">
      <BrandsManager />
    </div>
  );
}
