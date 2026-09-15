"use client";

import * as React from "react";
import { SendHorizontal } from "lucide-react";
import { sendMessage } from "@/actions/messaging";
import type { ThreadMessage } from "@/db/queries/messaging";
import { MAX_BODY_CHARS } from "@/lib/messaging/rules";
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
  const [error, setError] = React.useState<string | null>(null);
  // A plain flag rather than `useTransition`: an async transition re-rendering
  // this component mid-send failed React's hook-order check in the DOM lane
  // ("Rendered more hooks than during the previous render"), and a send needs
  // nothing a transition offers over a boolean. The ref blocks a second send
  // that lands before the state update does.
  const [pending, setPending] = React.useState(false);
  const sendingRef = React.useRef(false);
  const keyRef = React.useRef<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const trimmed = body.trim();
  const tooLong = trimmed.length > MAX_BODY_CHARS;

  async function send() {
    if (sendingRef.current || trimmed.length === 0 || tooLong) return;
    sendingRef.current = true;
    setPending(true);
    setError(null);
    keyRef.current ??= crypto.randomUUID();
    const clientKey = keyRef.current;
    try {
      const res = await sendMessage({ conversationId, body, clientKey });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      keyRef.current = null;
      setBody("");
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
    <div className="space-y-2 border-t border-gray-200 pt-3">
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            // Editing the text makes it a different message.
            keyRef.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Write a message"
          aria-label="Message"
          className="min-h-11 flex-1 resize-none"
        />
        <Button
          onClick={send}
          loading={pending}
          disabled={trimmed.length === 0 || tooLong}
          aria-label="Send message"
        >
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>
      {trimmed.length >= COUNTER_FROM && (
        <p className={tooLong ? "text-small text-red-500" : "text-small text-gray-500"}>
          {trimmed.length.toLocaleString("en-US")} / {MAX_BODY_CHARS.toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
