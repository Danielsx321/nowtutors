"use client";

import * as React from "react";
import { FileText, ImageOff } from "lucide-react";
import { getAttachmentUrl } from "@/actions/messaging";
import type { ThreadAttachment } from "@/db/queries/messaging";
import { cn } from "@/lib/utils";

/**
 * A message attachment (SPEC §7.9; Phase 9 Part 2).
 *
 * The bucket is private, so nothing here has a permanent URL. An image asks
 * `getAttachmentUrl` for a 5-minute signed link when it mounts; a PDF asks when
 * it's opened, so the link is always fresh at the moment it's used. The action
 * checks the viewer is a participant before it signs anything.
 *
 * A plain `<img>`, not `next/image`: a signed link expires in minutes and must
 * not be cached by the image optimizer or allowed in `remotePatterns`, which
 * only admits the public avatars path.
 */
export function AttachmentPreview({
  messageId,
  conversationId,
  attachment,
  mine,
}: {
  messageId: string;
  conversationId: string;
  attachment: ThreadAttachment;
  mine: boolean;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);

  React.useEffect(() => {
    if (attachment.kind !== "image") return;
    let cancelled = false;
    void getAttachmentUrl({ messageId, conversationId })
      .then((signed) => {
        if (cancelled) return;
        if (signed) setUrl(signed);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.kind, messageId, conversationId]);

  if (attachment.kind === "image") {
    if (failed) {
      return (
        <p className={cn("flex items-center gap-1.5 text-small", mine ? "text-purple-100" : "text-gray-500")}>
          <ImageOff className="size-4" aria-hidden />
          Image unavailable
        </p>
      );
    }
    if (!url) {
      return (
        <div
          className="h-40 w-56 max-w-full animate-pulse rounded-md bg-black/10"
          role="img"
          aria-label={`Loading ${attachment.name}`}
        />
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="focus-ring block rounded-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, see above */}
        <img
          src={url}
          alt={attachment.name}
          className="max-h-64 max-w-full rounded-md object-contain"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        // Opened before the await so a popup blocker treats it as a user action.
        const tab = window.open("", "_blank", "noopener,noreferrer");
        try {
          const signed = await getAttachmentUrl({ messageId, conversationId });
          if (signed && tab) tab.location.href = signed;
          else {
            tab?.close();
            setFailed(true);
          }
        } catch {
          tab?.close();
          setFailed(true);
        } finally {
          setOpening(false);
        }
      }}
      className={cn(
        "focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-small",
        mine ? "bg-purple-700/40 hover:bg-purple-700/60" : "bg-white hover:bg-gray-50",
      )}
    >
      <FileText className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <span className="shrink-0 text-caption">{failed ? "Unavailable" : opening ? "Opening…" : "Open"}</span>
    </button>
  );
}
