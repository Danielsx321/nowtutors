"use client";

import * as React from "react";
import Link from "next/link";
import { Check, X, ExternalLink } from "lucide-react";
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
import { approveTutor, rejectTutor, markTutorReviewed } from "@/actions/admin-tutors";

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

function Detail({ tutor }: { tutor: QueueTutor }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Avatar src={tutor.avatarUrl} name={tutor.displayName ?? "Tutor"} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-body-lg font-bold text-gray-700">
            {tutor.displayName ?? "Unnamed"}
          </p>
          <p className="text-small text-gray-500">{tutor.email}</p>
          {tutor.country && (
            <p className="text-small text-gray-500">{tutor.country}</p>
          )}
        </div>
        <PriceTag credits={tutor.hourlyRateCredits} unit="hr" size="sm" />
      </div>

      {tutor.headline && (
        <p className="text-body font-medium text-gray-700">{tutor.headline}</p>
      )}
      {tutor.about && (
        <p className="whitespace-pre-line text-small text-gray-700">{tutor.about}</p>
      )}

      {tutor.subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tutor.subjects.map((s) => (
            <SubjectChip key={s.slug} className="text-caption">
              {s.name}
              {s.level && <span className="text-gray-500">· {s.level}</span>}
            </SubjectChip>
          ))}
        </div>
      )}

      <dl className="grid gap-x-4 gap-y-1 text-small sm:grid-cols-2">
        {tutor.languages.length > 0 && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Languages</dt>
            <dd className="text-gray-700">{tutor.languages.join(", ")}</dd>
          </div>
        )}
        {tutor.education && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Education</dt>
            <dd className="text-gray-700">{tutor.education}</dd>
          </div>
        )}
        {tutor.yearsExperience != null && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Experience</dt>
            <dd className="text-gray-700">{tutor.yearsExperience} years</dd>
          </div>
        )}
        {tutor.introVideoUrl && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Intro video</dt>
            <dd>
              <Link
                href={tutor.introVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex items-center gap-1 rounded-sm text-purple-500 hover:underline"
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

export function PendingCard({ tutor }: { tutor: QueueTutor }) {
  const [note, setNote] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <Detail tutor={tutor} />
        {error && <Alert variant="danger">{error}</Alert>}

        {showReject && (
          <div className="space-y-1.5">
            <Label htmlFor={`note-${tutor.userId}`} required>
              Reason for rejection (sent to the tutor later)
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

        <div className="flex flex-wrap gap-2">
          <Button
            loading={pending}
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
            <Button variant="secondary" onClick={() => setShowReject(true)}>
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
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Edited since review</Badge>
          <span className="text-caption text-gray-500">
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
          <Button asChild variant="secondary">
            <Link href={`/tutors/${tutor.slug}`} target="_blank">
              View public page
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function QueueEmpty({ label }: { label: string }) {
  return <EmptyState title={label} description="Nothing needs your attention here." />;
}
