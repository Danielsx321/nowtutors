/**
 * What stops a tutor being approved (live-globe rebuild Part G; Noora's
 * answers, decision 4: a real photo before a tutor can teach). One pure rule
 * shared by the approve action, which refuses on the server, and the queue,
 * which disables Approve and says why. The server check is the authority; the
 * disabled button is a courtesy.
 */
export type ApprovalBlocker = "avatar_missing";

export function approvalBlocker(tutor: { avatarUrl: string | null | undefined }): ApprovalBlocker | null {
  if (!tutor.avatarUrl || !tutor.avatarUrl.trim()) return "avatar_missing";
  return null;
}

export function approvalBlockerMessage(blocker: ApprovalBlocker): string {
  switch (blocker) {
    case "avatar_missing":
      return "Can't approve yet: a profile photo is required.";
  }
}
