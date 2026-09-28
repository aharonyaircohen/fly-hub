/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Instructions page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import type { ReactNode } from "react";
import { InstructionsManager } from "../components/InstructionsManager";

export default function InstructionsPage({
  footerSlot,
}: {
  footerSlot?: ReactNode;
} = {}) {
  return <InstructionsManager footerSlot={footerSlot} />;
}
