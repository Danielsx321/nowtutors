"use client";

import * as React from "react";
import { CalendarDays, Users, Wallet, Inbox, Search } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LivePill } from "@/components/ui/live-pill";
import { Avatar } from "@/components/ui/avatar";
import { RatingStars } from "@/components/ui/rating-stars";
import { SubjectChip } from "@/components/ui/subject-chip";
import { PriceTag } from "@/components/ui/price-tag";
import { CreditBalance } from "@/components/ui/credit-balance";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DataDisplaySection({ surface }: { surface: Surface }) {
  const [page, setPage] = React.useState(3);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({
    Physics: true,
  });

  return (
    <Section id="data-display" title="Data display" surface={surface}>
      <Demo label="Card — white & ink surfaces" surface={surface} className="items-stretch">
        <Card className="w-72">
          <CardHeader>
            <CardTitle>Scheduled session</CardTitle>
            <CardDescription>Tomorrow, 3:00 PM</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body text-gray-500">
              60 minutes of Physics with Dr. Rao.
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm">Join</Button>
            <Button size="sm" variant="ghost">
              Reschedule
            </Button>
          </CardFooter>
        </Card>
        <Card surface="ink" className="w-72">
          <CardHeader>
            <CardTitle>Go live</CardTitle>
            <CardDescription className="text-gray-200">
              Broadcast to your audience
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body text-gray-200">
              Elevated dark surface for the authenticated shell.
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm">Start broadcast</Button>
          </CardFooter>
        </Card>
      </Demo>

      <Demo label="Stat card" surface={surface} className="items-stretch">
        <StatCard
          className="w-56"
          label="Upcoming sessions"
          value="4"
          icon={<CalendarDays className="size-5" />}
          hint="this week"
        />
        <StatCard
          className="w-56"
          label="Active students"
          value="128"
          icon={<Users className="size-5" />}
          trend={{ direction: "up", label: "12%" }}
        />
        <StatCard
          surface="ink"
          className="w-56"
          label="Available credits"
          value="1,240"
          icon={<Wallet className="size-5" />}
          hint="≈ $124.00"
        />
      </Demo>

      <Demo label="Table" surface={surface} className="items-stretch">
        <Card className="w-full overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Ada Lovelace", "Mathematics", "success", "Confirmed"],
                ["Alan Turing", "Physics", "warning", "Pending"],
                ["Grace Hopper", "English", "neutral", "Completed"],
              ].map(([name, subj, variant, status]) => (
                <TableRow key={name}>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <Avatar name={name} size="sm" /> {name}
                  </TableCell>
                  <TableCell>{subj}</TableCell>
                  <TableCell>
                    <Badge variant={variant as "success" | "warning" | "neutral"}>
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PriceTag credits={60} unit="hr" size="sm" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Demo>

      <Demo label="Badge & LivePill" surface={surface}>
        <Badge>Neutral</Badge>
        <Badge variant="purple">Purple</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="solid">Solid</Badge>
        <LivePill />
      </Demo>

      <Demo label="Avatar (image, initials fallback, broken src)" surface={surface}>
        <Avatar size="sm" name="Ada Lovelace" />
        <Avatar size="md" name="Grace Hopper" />
        <Avatar size="lg" name="Alan Turing" />
        <Avatar
          size="lg"
          name="Katherine Johnson"
          src="https://invalid.example/none.jpg"
        />
        <Avatar size="xl" name="Marie Curie" />
      </Demo>

      <Demo label="Rating stars" surface={surface}>
        <RatingStars value={4.5} count={128} />
        <RatingStars value={3} count={12} size="lg" />
        <RatingStars value={0} showValue={false} />
      </Demo>

      <Demo label="Subject chips (static, selectable, removable)" surface={surface}>
        {["Mathematics", "Physics", "English"].map((s) => (
          <SubjectChip
            key={s}
            interactive
            selected={!!selected[s]}
            onClick={() =>
              setSelected((prev) => ({ ...prev, [s]: !prev[s] }))
            }
          >
            {s}
          </SubjectChip>
        ))}
        <SubjectChip>Static</SubjectChip>
        <SubjectChip onRemove={() => {}}>Removable</SubjectChip>
      </Demo>

      <Demo label="Price & credit balance" surface={surface}>
        <PriceTag credits={60} unit="hr" usd={6} size="lg" />
        <PriceTag credits={1} unit="min" size="md" />
        <CreditBalance credits={1240} />
        <CreditBalance credits={1240} tone="ink" />
      </Demo>

      <Demo label="Breadcrumb" surface={surface} className="items-stretch">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Tutors", href: "/tutors" },
            { label: "Dr. Rao" },
          ]}
        />
      </Demo>

      <Demo label="Pagination" surface={surface} className="items-stretch">
        <Pagination page={page} pageCount={10} onPageChange={setPage} />
      </Demo>

      <Demo label="Empty state" surface={surface} className="items-stretch">
        <EmptyState
          className="w-full"
          icon={<Inbox className="size-6" />}
          title="No bookings yet"
          description="When you book a session it’ll show up here."
          action={
            <Button>
              <Search /> Browse tutors
            </Button>
          }
        />
      </Demo>
    </Section>
  );
}
