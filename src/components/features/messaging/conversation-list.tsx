import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import type { ConversationListItem as Item } from "@/db/queries/messaging";

/**
 * The inbox (SPEC §7.9, §10.2 `ConversationListItem`). Shared by students and
 * tutors; only `basePath` and the empty-state wording differ.
 */
export function ConversationList({
  items,
  basePath,
  timeZone,
  emptyDescription,
  emptyAction,
}: {
  items: Item[];
  /** `/dashboard/messages` or `/tutor/messages`. */
  basePath: string;
  timeZone: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="No messages yet"
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {items.map((item) => (
        <li key={item.id}>
          <ConversationListItem item={item} basePath={basePath} timeZone={timeZone} />
        </li>
      ))}
    </ul>
  );
}

function ConversationListItem({
  item,
  basePath,
  timeZone,
}: {
  item: Item;
  basePath: string;
  timeZone: string;
}) {
  const unread = item.unreadCount > 0;
  return (
    <Link
      href={`${basePath}/${item.id}`}
      className="focus-ring flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
    >
      <Avatar src={item.otherPartyAvatarUrl} name={item.otherPartyName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-body text-text", unread && "font-bold")}>
            {item.otherPartyName}
          </span>
          {item.lastMessageAt && (
            <span className="shrink-0 text-caption text-text-muted">
              {formatListTime(item.lastMessageAt, timeZone)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-small", unread ? "text-text" : "text-text-muted")}>
            {item.lastMessagePreview === null
              ? "No messages yet"
              : `${item.lastMessageFromMe ? "You: " : ""}${item.lastMessagePreview}`}
          </span>
          {unread && (
            <span
              className="grid min-w-5 shrink-0 place-items-center rounded-full bg-spark px-1.5 text-caption font-bold text-ink"
              aria-label={`${item.unreadCount} unread`}
            >
              {item.unreadCount > 99 ? "99+" : item.unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Today shows the time; anything older shows the date. */
function formatListTime(at: Date, timeZone: string): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
  if (day(at) === day(new Date())) {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  }
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
}
