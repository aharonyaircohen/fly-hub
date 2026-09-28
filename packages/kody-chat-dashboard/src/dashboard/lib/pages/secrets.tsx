/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Secrets page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { SecretsManager } from "../components/SecretsManager";

export default function SecretsPage() {
  return <SecretsManager />;
}
