/**
 * @fileType page
 * @domain kody
 * @pattern chat-conversation-page
 * @ai-summary Durable route for one saved Chat conversation. The persistent
 *   KodyChat remains mounted in ChatRailShell and reads the conversation id
 *   from the route, so refresh and direct links restore the same history.
 */
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Chat — Kody Operations Dashboard",
  description: "Continue a saved conversation with Kody",
  path: "/chat",
});

export default function KodyChatConversationPage() {
  return null;
}
