/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical View Renderers page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { ViewRenderersManager } from "../components/ViewRenderersManager";

export default function ViewRenderersPage() {
  return <ViewRenderersManager />;
}
