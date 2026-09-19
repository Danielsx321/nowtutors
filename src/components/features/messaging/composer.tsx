"use client";

import * as React from "react";
import { FileText, ImageIcon, Paperclip, SendHorizontal, X } from "lucide-react";
import { createAttachmentUpload, sendMessage } from "@/actions/messaging";
import type { ThreadMessage } from "@/db/queries/messaging";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_BUCKET,
  attachmentRefusalMessage,
  validateAttachment,
} from "@/lib/messaging/attachments";
import { MAX_BODY_CHARS } from "@/lib/messaging/rules";
import { createClient } from "@/lib/supabase/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Show the counter once a message gets this close to the limit. */
const COUNTER_FROM = MAX_BODY_CHARS - 500;

/**
 * The message box under a thread (SPEC §7.9).
 *
 * **One client key per message, kept across retries.** The key is made when a
 * message is first sent and only replaced after that message lands. If a send
 * fails part-way (the request timed out after the insert committed), pressing
 * Send again reuses the key and the server returns the message that already
 * exists instead of posting it twice.
 *
 * **One attachment per message (Part 2).** The file is checked here for type and
 * size, then uploaded through a signed upload the server issues for a path it
 * chooses, then sent. The uploaded path is kept with the client key, so a retry
 * after a failed send doesn't upload the file again. Changing the text or the
 * file makes it a new message: new key, new upload.
 *
 * Enter sends and Shift+Enter adds a new line. An IME composition in progress
 * never sends, so a Japanese or Chinese keyboard confirming a word doesn't post
 * half a sentence.
 */
export function Composer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: (message: ThreadMessage) => void;
}) {
  const [body, setBody] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A plain flag rather than `useTransition`: an async transition re-rendering
  // this component mid-send failed React's hook-order check in the DOM lane
  // ("Rendered more hooks than during the previous render"), and a send needs
  // nothing a transition offers over a boolean. The ref blocks a second send
  // that lands before the state update does.
  const [pending, setPending] = React.useState(false);
  const sendingRef = React.useRef(false);
  const keyRef = React.useRef<string | null>(null);
  const uploadedPathRef = React.useRef<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const trimmed = body.trim();
  const tooLong = trimmed.length > MAX_BODY_CHARS;
  const canSend = (trimmed.length > 0 || file !== null) && !tooLong;

  function newMessage() {
    keyRef.current = null;
    uploadedPathRef.current = null;
  }

  function chooseFile(next: File | null) {
    newMessage();
    if (!next) {
      setFile(null);
      return;
    }
    const check = validateAttachment({ name: next.name, type: next.type, size: next.size });
    if (!check.ok) {
      setError(attachmentRefusalMessage(check.reason));
      setFile(null);
      return;
    }
    setError(null);
    setFile(next);
  }

  async function upload(chosen: File): Promise<string | null> {
    if (uploadedPathRef.current) return uploadedPathRef.current;
    const signed = await createAttachmentUpload({
      conversationId,
      name: chosen.name,
      type: chosen.type,
      size: chosen.size,
    });
    if ("error" in signed) {
      setError(signed.error);
      return null;
    }
    const { error: upErr } = await createClient()
      .storage.from(ATTACHMENT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, chosen, { contentType: chosen.type });
    if (upErr) {
      setError(attachmentRefusalMessage("attachment_missing"));
      return null;
    }
    uploadedPathRef.current = signed.path;
    return signed.path;
  }

  async function send() {
    if (sendingRef.current || !canSend) return;
    sendingRef.current = true;
    setPending(true);
    setError(null);
    keyRef.current ??= crypto.randomUUID();
    const clientKey = keyRef.current;
    try {
      const attachmentPath = file ? await upload(file) : null;
      if (file && !attachmentPath) return;
      const res = await sendMessage({ conversationId, body, clientKey, attachmentPath });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      newMessage();
      setBody("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSent(res.message);
      inputRef.current?.focus();
    } catch {
      setError("Your message didn't send. Check your connection and try again.");
    } finally {
      sendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {error && <Alert variant="danger">{error}</Alert>}
      {file && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-small text-text">
          {file.type === "application/pdf" ? (
            <FileText className="size-4 shrink-0 text-text-muted" aria-hidden />
          ) : (
            <ImageIcon className="size-4 shrink-0 text-text-muted" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            className="focus-ring rounded-sm text-text-muted hover:text-text"
            aria-label={`Remove ${file.name}`}
            disabled={pending}
            onClick={() => {
              chooseFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          className="sr-only"
          aria-label="Attach a file"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Attach jpg, png or PDF"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden />
        </Button>
        <Textarea
          ref={inputRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            // Editing the text makes it a different message.
            newMessage();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Write a message"
          aria-label="Message"
          className="min-h-11 flex-1 resize-none"
        />
        <Button onClick={() => void send()} loading={pending} disabled={!canSend} aria-label="Send message">
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>
      {trimmed.length >= COUNTER_FROM && (
        <p className={tooLong ? "text-small text-danger" : "text-small text-text-muted"}>
          {trimmed.length.toLocaleString("en-US")} / {MAX_BODY_CHARS.toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
