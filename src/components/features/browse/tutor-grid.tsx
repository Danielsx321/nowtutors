import * as React from "react";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED, TRUST_PAYMENT } from "@/lib/copy/trust";
import { TutorCard, type TutorCardProps } from "@/components/features/tutor-card";
import type { TutorCardData } from "@/db/queries/tutors";

/** The promise tile sits after this many cards, where a student is deciding. */
const PROMISE_AFTER = 3;

/**
 * The card grid home and browse share (round 3 Part C): four across at
 * 1440 beside the sidebar, the `row` variant below `md`, and the blue promise
 * tile after the third card. The cards' names are h3, so the caller gives the
 * grid an h2.
 */
export function TutorGrid({
  cards,
  cardProps,
}: {
  cards: TutorCardData[];
  cardProps: Omit<TutorCardProps, "tutor" | "variant">;
}) {
  const promiseAfter = TRUST_GUARANTEE_CONFIRMED && cards.length > PROMISE_AFTER ? PROMISE_AFTER : -1;
  return (
    <>
      <ul className="hidden gap-[18px] md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((tutor, i) => (
          <GridItem key={tutor.userId} showPromise={i === promiseAfter}>
            <TutorCard tutor={tutor} {...cardProps} />
          </GridItem>
        ))}
      </ul>
      <ul className="grid gap-3 md:hidden">
        {cards.map((tutor, i) => (
          <GridItem key={tutor.userId} showPromise={i === promiseAfter}>
            <TutorCard tutor={tutor} {...cardProps} variant="row" />
          </GridItem>
        ))}
      </ul>
    </>
  );
}

/** A grid cell, with the blue promise tile placed before it when due. */
function GridItem({ showPromise, children }: { showPromise: boolean; children: React.ReactNode }) {
  return (
    <>
      {showPromise && (
        <li className="flex flex-col justify-between gap-4 rounded-card bg-primary p-6 text-on-primary">
          <b className="font-display text-[26px] font-medium leading-[1.1] tracking-[-0.02em]">
            {TRUST_GUARANTEE}
          </b>
          <p className="text-small text-on-primary/75">
            The no-show promise on every session · {TRUST_PAYMENT}
          </p>
        </li>
      )}
      <li className="list-none">{children}</li>
    </>
  );
}
