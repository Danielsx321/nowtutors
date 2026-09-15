/**
 * Message attachment rules (SPEC §7.9; Phase 9 Part 2).
 *
 * Settled 2026-09-15: jpg, png and PDF, up to 10 MB, one per message. The
 * private `message-attachments` bucket (`drizzle/0019`) enforces the same size
 * and types, so a client that skips these checks is still refused by Storage.
 *
 * **Objects live at `{conversationId}/{uuid}/{safe name}`.** The server makes
 * the path, the client never names it, and a send is refused unless the path it
 * carries parses back under that same conversation. A participant therefore
 * can't attach an object from a thread they aren't in, even by guessing its path.
 *
 * `messages.attachment_url` stores the PATH, never a URL. Every download is a
 * short-lived signed URL issued after a participant check.
 *
 * Pure and `server-only`-free so the unit lane and the composer can both import it.
 */

export const ATTACHMENT_BUCKET = "message-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_NAME_CHARS = 80;

export type AttachmentKind = "image" | "pdf";

const TYPES: Record<string, { kind: AttachmentKind; exts: readonly string[] }> = {
  "image/jpeg": { kind: "image", exts: ["jpg", "jpeg"] },
  "image/png": { kind: "image", exts: ["png"] },
  "application/pdf": { kind: "pdf", exts: ["pdf"] },
};

export const ALLOWED_ATTACHMENT_TYPES = Object.keys(TYPES);

/** For `<input accept>`: the MIME types and their extensions. */
export const ATTACHMENT_ACCEPT = [
  ...ALLOWED_ATTACHMENT_TYPES,
  ...Object.values(TYPES).flatMap((t) => t.exts.map((e) => `.${e}`)),
].join(",");

export type AttachmentRefusal = "attachment_type" | "attachment_too_large" | "attachment_empty";

export interface AttachmentFile {
  name: string;
  /** The browser-reported MIME type. */
  type: string;
  size: number;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Is this file allowed? Both the MIME type and the extension must be on the
 * list and agree, so `invoice.pdf` sent as `text/html` and `photo.html` sent as
 * `image/png` are both refused.
 */
export function validateAttachment(
  file: AttachmentFile,
): { ok: true; kind: AttachmentKind } | { ok: false; reason: AttachmentRefusal } {
  const entry = TYPES[file.type];
  if (!entry || !entry.exts.includes(extensionOf(file.name))) {
    return { ok: false, reason: "attachment_type" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: "attachment_empty" };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "attachment_too_large" };
  return { ok: true, kind: entry.kind };
}

/**
 * A storage-safe version of the user's file name: letters, digits, dot, dash and
 * underscore only, no leading dots, no path separators, at most
 * {@link MAX_NAME_CHARS} characters, and always ending in the extension it was
 * validated with. `../../etc/passwd.png` becomes `etc_passwd.png`.
 */
export function safeFileName(name: string): string {
  const ext = extensionOf(name) || "bin";
  const base = name
    .slice(0, name.length - (extensionOf(name) ? ext.length + 1 : 0))
    .replace(/[\\/]+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  const room = MAX_NAME_CHARS - ext.length - 1;
  return `${(base || "file").slice(0, room)}.${ext}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SAFE_NAME = `[A-Za-z0-9_-][A-Za-z0-9._-]{0,${MAX_NAME_CHARS - 1}}`;
const PATH = new RegExp(`^(${UUID})/(${UUID})/(${SAFE_NAME})$`);

/** `{conversationId}/{objectId}/{safe name}`. */
export function attachmentObjectPath(conversationId: string, objectId: string, name: string): string {
  return `${conversationId}/${objectId}/${safeFileName(name)}`;
}

/**
 * Parse a stored path back into what the thread shows. Null for anything that
 * isn't a well-formed attachment path with an allowed extension.
 */
export function parseAttachmentPath(
  path: string,
): { conversationId: string; name: string; kind: AttachmentKind } | null {
  const m = PATH.exec(path);
  if (!m) return null;
  const name = m[3];
  const ext = extensionOf(name);
  const entry = Object.values(TYPES).find((t) => t.exts.includes(ext));
  if (!entry || name.includes("..")) return null;
  return { conversationId: m[1], name, kind: entry.kind };
}

/**
 * Does `path` belong to `conversationId`? The check a send runs before it will
 * attach an object: well-formed, allowed extension, and under this thread's prefix.
 */
export function isAttachmentPathFor(conversationId: string, path: string): boolean {
  const parsed = parseAttachmentPath(path);
  return parsed !== null && parsed.conversationId === conversationId;
}

export function attachmentRefusalMessage(reason: AttachmentRefusal | "attachment_missing"): string {
  switch (reason) {
    case "attachment_type":
      return "You can attach jpg, png or PDF files.";
    case "attachment_too_large":
      return "Files can be up to 10 MB.";
    case "attachment_empty":
      return "That file is empty.";
    case "attachment_missing":
      return "The attachment didn't upload. Try attaching it again.";
  }
}
