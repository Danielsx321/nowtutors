"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSubject,
  renameSubject,
  setSubjectActive,
  type AdminSubjectActionResult,
} from "@/actions/admin-subjects";

export interface ManagedSubject {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  tutorCount: number;
  studentCount: number;
  bookingCount: number;
}

type Outcome = { kind: "ok" | "error"; text: string } | null;
const toOutcome = (res: AdminSubjectActionResult): Outcome =>
  "error" in res ? { kind: "error", text: res.error } : { kind: "ok", text: res.message };

function OutcomeAlert({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <Alert variant={outcome.kind === "ok" ? "success" : "danger"} role="status">
      {outcome.text}
    </Alert>
  );
}

function CreateForm() {
  const [name, setName] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardContent className="p-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setOutcome(null);
              const res = await createSubject({ name });
              setOutcome(toOutcome(res));
              if (!("error" in res)) setName("");
            });
          }}
        >
          <Label htmlFor="new-subject" required>
            Add a subject
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="new-subject"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 basis-60"
              autoComplete="off"
            />
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              Add
            </Button>
          </div>
          <OutcomeAlert outcome={outcome} />
        </form>
      </CardContent>
    </Card>
  );
}

function SubjectRow({ subject }: { subject: ManagedSubject }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(subject.name);
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();
  const inputId = `subject-${subject.id}`;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {editing ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    setOutcome(null);
                    const res = await renameSubject({ subjectId: subject.id, name });
                    setOutcome(toOutcome(res));
                    if (!("error" in res)) setEditing(false);
                  });
                }}
              >
                <label htmlFor={inputId} className="sr-only">
                  New name for {subject.name}
                </label>
                <Input
                  id={inputId}
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  className="min-w-0 flex-1 basis-48"
                  autoComplete="off"
                />
                <Button type="submit" size="sm" loading={pending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setName(subject.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <p className="text-body font-bold text-gray-700">{subject.name}</p>
            )}
            <p className="text-caption text-gray-500">
              <code>{subject.slug}</code> · {subject.tutorCount} tutors · {subject.studentCount} students ·{" "}
              {subject.bookingCount} bookings
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!subject.isActive && <Badge variant="warning">hidden</Badge>}
            {!editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Rename
              </Button>
            )}
            <Button
              size="sm"
              variant={subject.isActive ? "secondary" : "primary"}
              loading={pending && !editing}
              onClick={() =>
                start(async () => {
                  setOutcome(null);
                  setOutcome(toOutcome(await setSubjectActive({ subjectId: subject.id, active: !subject.isActive })));
                })
              }
            >
              {subject.isActive ? "Hide" : "Show again"}
            </Button>
          </div>
        </div>
        <OutcomeAlert outcome={outcome} />
      </CardContent>
    </Card>
  );
}

/** `/admin/subjects` controls (SPEC §6; Phase 8 Part 5). No delete, by design. */
export function SubjectManager({ subjects }: { subjects: ManagedSubject[] }) {
  return (
    <div className="space-y-4">
      <CreateForm />
      <ul className="space-y-3">
        {subjects.map((s) => (
          <li key={`${s.id}-${s.name}-${s.isActive}`}>
            <SubjectRow subject={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}
