/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Models page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { ModelsManager } from "../components/ModelsManager";

export default function ModelsPage() {
  return <ModelsManager />;
}
