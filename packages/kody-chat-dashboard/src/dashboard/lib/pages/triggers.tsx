/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Triggers page — hosts serve it as a one-line
 *   re-export.
 */
import { AuthGuard } from "../auth-guard";
import { TriggersManager } from "../components/TriggersManager";

export default function TriggersPage() {
  return (
    <AuthGuard>
      <TriggersManager />
    </AuthGuard>
  );
}
