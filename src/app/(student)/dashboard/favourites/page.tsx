import Link from "next/link";
import { HeartOff } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { getFavouriteTutors } from "@/db/queries/favourites";
import { TutorCard } from "@/components/features/tutor-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Saved tutors · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * The student's saved tutors (SPEC §6). Student-only, guarded here and by the
 * (student) layout; toggleFavourite re-checks independently (§5 Layer 2).
 *
 * Same TutorCard as browse, so live treatment derives from the live_tutors view
 * (§3.1). Unfavouriting revalidates this path, so the card disappears.
 */
export default async function FavouritesPage() {
  const { profile } = await requireRole("student");
  const cards = await getFavouriteTutors(profile.id);

  return (
    <div className="py-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Saved tutors</h1>
        <p className="text-body text-gray-500">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((tutor) => (
            <TutorCard key={tutor.userId} tutor={tutor} favouriteMode="student" />
          ))}
        </div>
      )}
    </div>
  );
}
