import Link from "next/link";
import {
  Card,
  CardContent,
  Avatar,
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
// never is_live (SPEC §3.1). The card is an ink surface, so the LIVE badge uses
// LivePill's ink variant (live-400 fill + ink-900 text, 4.75:1 — SPEC §10.1/§10.2).
// offline/online stay as white pills overlaying the ink avatar band.
function StatusBadge({ status }: { status: LiveStatus }) {
  if (status === "live") {
    return <LivePill surface="ink" className="shadow-sm" />;
  }
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
    <Card
      surface="ink"
      className="relative flex flex-col overflow-hidden transition-colors hover:bg-ink-800"
    >
      {/* One card surface (ink-900). The avatar band is the same fill as the
          content — separated by an ink-700 border, never a lighter/darker tone
          (§10 ink amendment: elevation by border, not by lightness). */}
      <div className="relative flex h-36 items-center justify-center border-b border-ink-700">
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
          <h3 className="text-body-lg font-bold text-white">
            {/* Stretched link makes the whole card clickable without nesting
                the heart inside an anchor. Gold focus ring on ink (SPEC §10.3);
                a purple ring would be invisible here. */}
            <Link
              href={`/tutors/${tutor.slug}`}
              className="focus-ring-on-ink rounded-sm after:absolute after:inset-0"
            >
              {tutor.displayName ?? "Tutor"}
            </Link>
          </h3>
          {tutor.country && (
            <span className="shrink-0 text-caption text-ink-300">
              {tutor.country}
            </span>
          )}
        </div>

        {tutor.headline && (
          <p className="line-clamp-1 text-small text-ink-300">
            {tutor.headline}
          </p>
        )}

        {/* Ratings intentionally not rendered: reviews are dropped for v1
            (§18), so every card would show "0.0 (0)". ratingAvg/ratingCount
            stay in the schema + query, just unrendered. */}

        {tutor.subjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tutor.subjects.map((s) => (
              <SubjectChip
                key={s}
                className="border-ink-700 bg-ink-800 text-caption text-white"
              >
                {s}
              </SubjectChip>
            ))}
          </div>
        )}

        <div className="mt-auto pt-1">
          <PriceTag
            credits={tutor.hourlyRateCredits}
            unit="hr"
            size="md"
            surface="ink"
          />
        </div>
      </CardContent>
    </Card>
  );
}
