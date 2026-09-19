import Link from "next/link";
import { eq } from "drizzle-orm";
import { Radio } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  getOwnLiveBroadcastId,
  listActiveSubjects,
  listTutorBroadcasts,
} from "@/db/queries/broadcasts";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StartBroadcastForm } from "@/components/features/broadcasts/start-broadcast-form";

export const metadata = { title: "Broadcasts · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/broadcasts`: go live to many students, and past broadcasts (SPEC §6,
 * §7.8; Phase 9 Part 3).
 *
 * `requireRole('tutor')` first, approval enforced (§5 Layer 2). If the tutor is
 * already live, the form is replaced by a link back to the host view;
 * `startBroadcast` refuses a second one regardless.
 */
export default async function TutorBroadcastsPage() {
  const { user } = await requireRole("tutor");

  const [liveId, history, subjects, [me]] = await Promise.all([
    getOwnLiveBroadcastId(user.id),
    listTutorBroadcasts(user.id),
    listActiveSubjects(),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me?.timezone ?? "UTC",
  });

  return (
    <div className="w-full space-y-6 py-2">
      <div className="space-y-1">
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Broadcasts</h1>
        <p className="text-body text-text-muted">
          Teach many students at once. Anyone can see you on Live now, and signed-in
          students watch for free.
        </p>
      </div>

      {liveId ? (
        <Alert variant="warning">
          You&apos;re live right now.{" "}
          <Link href={`/broadcast/${liveId}`} className="font-medium underline">
            Return to your broadcast
          </Link>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Go live</CardTitle>
          </CardHeader>
          <CardContent>
            <StartBroadcastForm subjects={subjects} />
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-h3 font-bold text-text">Past broadcasts</h2>
        {history.length === 0 ? (
          <EmptyState
            icon={<Radio className="size-6" />}
            title="No broadcasts yet"
            description="When you go live, your broadcasts show up here with how many people watched."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead className="text-right">Peak viewers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-text">
                      {b.status === "live" ? (
                        <Link href={`/broadcast/${b.id}`} className="focus-ring rounded-sm hover:underline">
                          {b.title}
                        </Link>
                      ) : (
                        b.title
                      )}
                    </TableCell>
                    <TableCell>{b.startedAt ? fmt.format(b.startedAt) : "—"}</TableCell>
                    <TableCell>
                      {b.status === "live" ? (
                        <Badge variant="success">Live</Badge>
                      ) : (
                        formatLength(b.startedAt, b.endedAt)
                      )}
                    </TableCell>
                    <TableCell className="text-right">{b.peakViewers}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {liveId && (
        <Button asChild variant="secondary">
          <Link href={`/broadcast/${liveId}`}>Open the host view</Link>
        </Button>
      )}
    </div>
  );
}

function formatLength(startedAt: Date | null, endedAt: Date | null): string {
  if (!startedAt || !endedAt) return "—";
  const minutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
