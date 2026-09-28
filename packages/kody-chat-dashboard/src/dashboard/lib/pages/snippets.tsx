/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Snippets page — hosts serve it as a one-line
 *   re-export.
 */
import { AuthGuard } from "../auth-guard";
import { SnippetsManager } from "../components/SnippetsManager";

export default function SnippetsPage() {
  return (
    <AuthGuard>
      <SnippetsManager />
    </AuthGuard>
  );
}
