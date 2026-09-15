import { requireRole } from "@/lib/auth/guards";
import { ConversationView } from "@/components/features/messaging/conversation-view";

export const metadata = { title: "Messages · NowTutors" };
export const dynamic = "force-dynamic";

/** `/tutor/messages/[conversationId]`: one thread (SPEC §6, §7.9). */
export default async function TutorConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const { user } = await requireRole("tutor");
  return (
    <ConversationView
      conversationId={conversationId}
      viewerId={user.id}
      backHref="/tutor/messages"
    />
  );
}
