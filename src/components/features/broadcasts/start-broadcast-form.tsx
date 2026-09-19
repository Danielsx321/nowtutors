"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startBroadcast } from "@/actions/broadcasts";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/broadcasts/service";

export interface StartBroadcastFormProps {
  subjects: { id: string; name: string }[];
}

/**
 * The "Go live" form on `/tutor/broadcasts` (SPEC §7.8; Phase 9 Part 3).
 *
 * Presentation only: `startBroadcast` re-checks approval, suspension, verified
 * email, an active subject, an in-progress session and an existing live
 * broadcast, all under the tutor row lock. On success the tutor lands on the
 * host view, which is where the camera turns on.
 */
export function StartBroadcastForm({ subjects }: StartBroadcastFormProps) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [liveHref, setLiveHref] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          setLiveHref(null);
          const res = await startBroadcast({ title, description, subjectId });
          if ("error" in res) {
            setError(res.error);
            setLiveHref(res.liveBroadcastHref ?? null);
            return;
          }
          router.push(res.href);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="broadcast-title" required>
          Title
        </Label>
        <Input
          id="broadcast-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Solving quadratic equations"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broadcast-description">What you&apos;ll cover</Label>
        <Textarea
          id="broadcast-description"
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-caption text-text-muted">
          {description.length}/{DESCRIPTION_MAX}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="broadcast-subject">Subject</Label>
        <select
          id="broadcast-subject"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="focus-ring h-11 w-full rounded-md border border-border bg-surface-raised px-3 text-body text-text"
        >
          <option value="">No subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Alert variant="danger" role="status">
          {error}
          {liveHref && (
            <>
              {" "}
              <Link href={liveHref} className="font-medium underline">
                Return to your broadcast
              </Link>
            </>
          )}
        </Alert>
      )}

      <p className="text-small text-text-muted">
        Your camera and microphone turn on when the broadcast page opens. Students
        can&apos;t send you instant session requests while you&apos;re live.
      </p>

      <Button type="submit" loading={pending} disabled={title.trim().length < 3}>
        Go live
      </Button>
    </form>
  );
}
