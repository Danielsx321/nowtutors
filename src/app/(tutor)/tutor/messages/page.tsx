import { requireRole } from "@/lib/auth/guards";
import { InboxView } from "@/components/features/messaging/inbox-view";

export const metadata = { title: "Messages · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/messages`: the tutor's conversations (SPEC §6, §7.9). Tutors reply to
 * threads students open; they can't start one (settled 2026-09-15).
 */
export default async function TutorMessagesPage() {
  const { user } = await requireRole("tutor");
  return (
    <InboxView
      viewerId={user.id}
      basePath="/tutor/messages"
      emptyDescription="When a student messages you, the conversation shows up here."
    />
  );
}
