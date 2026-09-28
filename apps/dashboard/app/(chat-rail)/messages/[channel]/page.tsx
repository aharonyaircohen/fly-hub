/**
 * @fileType page
 * @domain kody
 * @pattern messages-selected-channel-page
 * @ai-summary Selected Messages channel route. Keeps channel selection
 * addressable at `/messages/<channel>`.
 */
import { MessagesView } from "@dashboard/features/messages/components/MessagesView";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Messages - Kody Operations Dashboard",
  description: "View a selected Messages channel.",
  path: "/messages",
});

export default async function SelectedMessagesChannelPage({
  params,
}: {
  params: Promise<{ channel: string }>;
}) {
  const { channel } = await params;
  const selectedChannelNumber = Number(channel);
  return (
    <div className="h-full p-0 md:p-4">
      <MessagesView
        selectedChannelNumber={
          Number.isInteger(selectedChannelNumber) && selectedChannelNumber > 0
            ? selectedChannelNumber
            : null
        }
      />
    </div>
  );
}
