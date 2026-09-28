/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Widgets page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { WidgetsManager } from "../components/WidgetsManager";

export default function WidgetsPage() {
  return <WidgetsManager />;
}
