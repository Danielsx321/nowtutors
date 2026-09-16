import Link from "next/link";
import { HeartOff } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { getFavouriteTutors } from "@/db/queries/favourites";
import { TutorCard } from "@/components/features/tutor-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { getUsdPerCredit } from "@/lib/settings";

export const metadata = { title: "Saved tutors · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * The student's saved tutors (SPEC §6). Student-only, guarded here and by the
 * (student) layout; toggleFavourite re-checks independently (§5 Layer 2).
 *
 * Same TutorCard as browse, in its row variant (a short list reads better as
 * rows), so live treatment derives from the live_tutors view (§3.1). Unfavouriting revalidates this path, so the card disappears.
 */
export default async function FavouritesPage() {
  const { profile } = await requireRole("student");
  const [cards, usdPerCredit] = await Promise.all([
    getFavouriteTutors(profile.id),
    getUsdPerCredit(),
  ]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-h1 font-bold text-text">Saved tutors</h1>
        <p className="text-body text-text-muted">
          {cards.length === 0
            ? "Tutors you save appear here."
            : `${cards.length} saved tutor${cards.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={<HeartOff className="size-6" />}
          title="No saved tutors yet"
          description="Tap the heart on any tutor to save them here for later."
          action={
            <Button asChild>
              <Link href="/">Browse tutors</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {cards.map((tutor) => (
            <li key={tutor.userId}>
              <TutorCard
                tutor={tutor}
                favouriteMode="student"
                usdPerCredit={usdPerCredit}
                variant="row"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
