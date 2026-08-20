import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  Avatar,
  RatingStars,
  SubjectChip,
  PriceTag,
  LivePill,
} from "@/components/ui";
import {
  FavouriteHeart,
  type FavouriteMode,
} from "@/components/features/favourite-heart";
import type { TutorCardData, LiveStatus } from "@/db/queries/tutors";

// Live badge text switches by status; all derived from live_tutors membership,
// never is_live (SPEC §3.1). offline is a subtle chip; online/live are prominent.
function StatusBadge({ status }: { status: LiveStatus }) {
  if (status === "live") return <LivePill />;
  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-caption font-medium text-gray-700 shadow-sm">
        <span className="size-2 rounded-full bg-live-500" aria-hidden />
        Now Online
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-caption font-medium text-gray-500 shadow-sm">
      <span className="size-2 rounded-full bg-gray-200" aria-hidden />
      Offline
    </span>
  );
}

export interface TutorCardProps {
  tutor: TutorCardData;
  favouriteMode: FavouriteMode;
  loginHref?: string;
}

export function TutorCard({ tutor, favouriteMode, loginHref }: TutorCardProps) {
  return (
    <Card className="relative flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div className="relative flex h-36 items-center justify-center bg-purple-100">
        <Avatar
          src={tutor.avatarUrl}
          name={tutor.displayName ?? "Tutor"}
          size="xl"
        />
        <div className="absolute left-2 top-2">
          <StatusBadge status={tutor.liveStatus} />
        </div>
        <FavouriteHeart
          className="absolute right-2 top-2 z-10"
          tutorId={tutor.userId}
          initialFavourited={tutor.isFavourited}
          mode={favouriteMode}
          loginHref={loginHref}
        />
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-body-lg font-bold text-gray-700">
            {/* Stretched link makes the whole card clickable without nesting
                the heart inside an anchor. */}
            <Link
              href={`/tutors/${tutor.slug}`}
              className="focus-ring rounded-sm after:absolute after:inset-0"
            >
              {tutor.displayName ?? "Tutor"}
            </Link>
          </h3>
          {tutor.country && (
            <span className="shrink-0 text-caption text-gray-500">
              {tutor.country}
            </span>
          )}
        </div>

        {tutor.headline && (
          <p className="line-clamp-1 text-small text-gray-500">
            {tutor.headline}
          </p>
        )}

        <RatingStars value={tutor.ratingAvg} count={tutor.ratingCount} size="sm" />

        {tutor.subjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tutor.subjects.map((s) => (
              <SubjectChip key={s} className="text-caption">
                {s}
              </SubjectChip>
            ))}
          </div>
        )}

        <div className={cn("mt-auto pt-1")}>
          <PriceTag credits={tutor.hourlyRateCredits} unit="hr" size="md" />
        </div>
      </CardContent>
    </Card>
  );
}
