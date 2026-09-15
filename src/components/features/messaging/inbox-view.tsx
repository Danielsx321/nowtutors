import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { listConversationsFor } from "@/db/queries/messaging";
import { ConversationList } from "@/components/features/messaging/conversation-list";

/**
 * The inbox page body, shared by `/dashboard/messages` and `/tutor/messages`
 * (SPEC §6, §7.9). The route has already authorized the viewer; this only
 * renders their own threads.
 */
export async function InboxView({
  viewerId,
  basePath,
  emptyDescription,
  emptyAction,
}: {
  viewerId: string;
  basePath: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}) {
  const [items, [me]] = await Promise.all([
    listConversationsFor(viewerId),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, viewerId)).limit(1),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-h2 font-bold text-gray-700">Messages</h1>
      <ConversationList
        items={items}
        basePath={basePath}
        timeZone={me?.timezone ?? "UTC"}
        emptyDescription={emptyDescription}
        emptyAction={emptyAction}
      />
    </div>
  );
}
