"use client";

import { approvalBlocker, approvalBlockerMessage } from "@/lib/tutors/approval";
import { CHANGE_REASONS, changeReason, parseApprovalNote, type ChangeReason } from "@/lib/tutors/change-reasons";
import * as React from "react";
import Link from "next/link";
import { Check, X, ExternalLink, Pencil } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubjectChip } from "@/components/ui/subject-chip";
import { PriceTag } from "@/components/ui/price-tag";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { approveTutor, rejectTutor, markTutorReviewed, requestTutorChanges } from "@/actions/admin-tutors";

export interface QueueTutor {
  userId: string;
  slug: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  country: string | null;
  headline: string | null;
  about: string | null;
  introVideoUrl: string | null;
  education: string | null;
  yearsExperience: number | null;
  languages: string[];
  hourlyRateCredits: number;
  approvalNote: string | null;
  subjects: { name: string; slug: string; level: string | null }[];
  profileChangedAt: string | null;
  profileReviewedAt: string | null;
}

/**
 * The "Request changes" form (tutor-request-changes): tick what to fix, add a
 * note if the tick boxes don't say it, send. The action refuses an empty
 * request; the tutor gets the ticked reasons with guidance and the note.
 */
function RequestChangesForm({
  tutorId,
  onCancel,
  onError,
}: {
  tutorId: string;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [reasons, setReasons] = React.useState<ChangeReason[]>([]);
  const [note, setNote] = React.useState("");
  const [pending, start] = React.useTransition();
  const toggle = (key: ChangeReason, on: boolean) =>
    setReasons((r) => (on ? Array.from(new Set([...r, key])) : r.filter((k) => k !== key)));

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-small font-semibold text-text">What should they change?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CHANGE_REASONS.map((r) => (
          <label key={r.key} className="flex cursor-pointer items-center gap-2 text-small text-text">
            <Checkbox
              checked={reasons.includes(r.key)}
              onCheckedChange={(v) => toggle(r.key, v === true)}
              aria-label={r.label}
            />
            {r.label}
          </label>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`changes-${tutorId}`}>Anything else (emailed to the tutor)</Label>
        <Textarea id={`changes-${tutorId}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-caption text-text-muted">
        They leave the site until you approve them again. Sessions already booked still run.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              onError(null);
              const res = await requestTutorChanges({ tutorId, reasons, note });
              if ("error" in res) onError(res.error);
            })
          }
        >
          <Pencil aria-hidden />
          Send request
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** What was asked for, as the tutor sees it, so the admin can check the fix against it. */
function AskedFor({ note }: { note: string | null }) {
  const parsed = parseApprovalNote(note);
  if (parsed.reasons.length === 0 && !parsed.note) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface-muted p-3 text-small">
      <p className="font-semibold text-text">Asked for</p>
      {parsed.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {parsed.reasons.map((k) => (
            <Badge key={k} variant="warning">
              {changeReason(k).label}
            </Badge>
          ))}
        </div>
      )}
      {parsed.note && <p className="whitespace-pre-line text-text">{parsed.note}</p>}
    </div>
  );
}

function Detail({ tutor }: { tutor: QueueTutor }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Avatar src={tutor.avatarUrl} name={tutor.displayName ?? "Tutor"} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-body-lg font-bold text-text">
            {tutor.displayName ?? "Unnamed"}
          </p>
          <p className="text-small text-text-muted">{tutor.email}</p>
          {tutor.country && (
            <p className="text-small text-text-muted">{tutor.country}</p>
          )}
        </div>
        <PriceTag credits={tutor.hourlyRateCredits} unit="hr" size="sm" />
      </div>

      {tutor.headline && (
        <p className="text-body font-medium text-text">{tutor.headline}</p>
      )}
      {tutor.about && (
        <p className="whitespace-pre-line text-small text-text">{tutor.about}</p>
      )}

      {tutor.subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tutor.subjects.map((s) => (
            <SubjectChip key={s.slug} className="text-caption">
              {s.name}
              {s.level && <span className="text-text-muted">· {s.level}</span>}
            </SubjectChip>
          ))}
        </div>
      )}

      <dl className="grid gap-x-4 gap-y-1 text-small sm:grid-cols-2">
        {tutor.languages.length > 0 && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Languages</dt>
            <dd className="text-text">{tutor.languages.join(", ")}</dd>
          </div>
        )}
        {tutor.education && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Education</dt>
            <dd className="text-text">{tutor.education}</dd>
          </div>
        )}
        {tutor.yearsExperience != null && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Experience</dt>
            <dd className="text-text">{tutor.yearsExperience} years</dd>
          </div>
        )}
        {tutor.introVideoUrl && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Intro video</dt>
            <dd>
              <Link
                href={tutor.introVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex items-center gap-1 rounded-sm text-accent hover:underline"
              >
                Watch <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function PendingCard({ tutor, resubmitted = false }: { tutor: QueueTutor; resubmitted?: boolean }) {
  const [note, setNote] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [showChanges, setShowChanges] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  // The photo rule (Part G). The action refuses anyway; this says why up front.
  const blocker = approvalBlocker(tutor);
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {resubmitted && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Resubmitted</Badge>
            <span className="text-caption text-text-muted">
              fixed {tutor.profileChangedAt ? new Date(tutor.profileChangedAt).toLocaleString() : "—"}
              {tutor.profileReviewedAt ? ` · on hold since ${new Date(tutor.profileReviewedAt).toLocaleString()}` : ""}
            </span>
          </div>
        )}
        <Detail tutor={tutor} />
        {resubmitted && <AskedFor note={tutor.approvalNote} />}
        {error && <Alert variant="danger">{error}</Alert>}

        {showChanges && (
          <RequestChangesForm tutorId={tutor.userId} onCancel={() => setShowChanges(false)} onError={setError} />
        )}

        {showReject && !showChanges && (
          <div className="space-y-1.5">
            <Label htmlFor={`note-${tutor.userId}`} required>
              Reason for rejection (emailed to the tutor)
            </Label>
            <Textarea
              id={`note-${tutor.userId}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <FieldError>
              {error && note.trim().length < 5 ? "A note is required." : undefined}
            </FieldError>
          </div>
        )}

        {blocker && (
          <p className="text-small font-medium text-spark-text">{approvalBlockerMessage(blocker)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={pending}
            disabled={!!blocker}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await approveTutor({ tutorId: tutor.userId });
                if ("error" in res) setError(res.error);
              })
            }
          >
            <Check aria-hidden />
            Approve
          </Button>
          {!showChanges && !showReject && (
            <Button variant="outline" onClick={() => setShowChanges(true)}>
              <Pencil aria-hidden />
              Request changes
            </Button>
          )}
          {showChanges ? null : showReject ? (
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await rejectTutor({ tutorId: tutor.userId, note });
                  if ("error" in res) setError(res.error);
                })
              }
            >
              Confirm rejection
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowReject(true)}>
              <X aria-hidden />
              Reject
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ChangedCard({ tutor }: { tutor: QueueTutor }) {
  const [error, setError] = React.useState<string | null>(null);
  const [showChanges, setShowChanges] = React.useState(false);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Edited since review</Badge>
          <span className="text-caption text-text-muted">
            changed{" "}
            {tutor.profileChangedAt
              ? new Date(tutor.profileChangedAt).toLocaleString()
              : "—"}
            {tutor.profileReviewedAt
              ? ` · last reviewed ${new Date(tutor.profileReviewedAt).toLocaleString()}`
              : " · never reviewed since approval"}
          </span>
        </div>

        <Detail tutor={tutor} />
        {error && <Alert variant="danger">{error}</Alert>}
        {showChanges && (
          <RequestChangesForm tutorId={tutor.userId} onCancel={() => setShowChanges(false)} onError={setError} />
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await markTutorReviewed({ tutorId: tutor.userId });
                if ("error" in res) setError(res.error);
              })
            }
          >
            <Check aria-hidden />
            Mark reviewed
          </Button>
          {!showChanges && (
            <Button variant="outline" onClick={() => setShowChanges(true)}>
              <Pencil aria-hidden />
              Request changes
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={`/tutors/${tutor.slug}`} target="_blank">
              View public page
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** On hold, waiting on the tutor. Read-only apart from Reject, so a hold that is never answered can be closed. */
export function OnHoldCard({ tutor }: { tutor: QueueTutor }) {
  const [note, setNote] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">On hold</Badge>
          <span className="text-caption text-text-muted">
            asked {tutor.profileReviewedAt ? new Date(tutor.profileReviewedAt).toLocaleString() : "—"} · waiting on the tutor
          </span>
        </div>
        <Detail tutor={tutor} />
        <AskedFor note={tutor.approvalNote} />
        <p className="text-caption text-text-muted">
          Off the site until they save a change and you approve it. Sessions already booked still run; cancel them from
          Bookings if needed.
        </p>
        {error && <Alert variant="danger">{error}</Alert>}

        {showReject && (
          <div className="space-y-1.5">
            <Label htmlFor={`note-${tutor.userId}`} required>
              Reason for rejection (emailed to the tutor)
            </Label>
            <Textarea id={`note-${tutor.userId}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {showReject ? (
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await rejectTutor({ tutorId: tutor.userId, note });
                  if ("error" in res) setError(res.error);
                })
              }
            >
              Confirm rejection
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowReject(true)}>
              <X aria-hidden />
              Reject
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function QueueEmpty({ label }: { label: string }) {
  return <EmptyState title={label} description="Nothing needs your attention here." />;
}
