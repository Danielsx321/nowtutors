import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { InboxView } from "@/components/features/messaging/inbox-view";

export const metadata = { title: "Messages · NowTutors" };
export const dynamic = "force-dynamic";

/** `/dashboard/messages`: the student's conversations (SPEC §6, §7.9). */
export default async function StudentMessagesPage() {
  const { user } = await requireRole("student");
  return (
    <InboxView
      viewerId={user.id}
      basePath="/dashboard/messages"
      emptyDescription="Find a tutor and press Message on their profile to ask a question before you book."
      emptyAction={
        <Link
          href="/tutors"
          className="focus-ring inline-flex h-11 items-center rounded-md bg-purple-500 px-4 text-body font-medium text-white hover:bg-purple-700"
        >
          Find tutors
        </Link>
      }
    />
  );
}
