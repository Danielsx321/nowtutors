import type { LucideIcon } from "lucide-react";
import {
  Home,
  CalendarDays,
  Wallet,
  MessageSquare,
  Settings,
  Users,
  GraduationCap,
  CreditCard,
  Banknote,
  BookOpen,
  ScrollText,
  Radio,
  Clock,
  UserRound,
  TrendingUp,
  Heart,
  MoreHorizontal,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Start a visual group above this item (sidebar only). */
  groupStart?: boolean;
}

/**
 * Navigation config (SPEC §6). Presentational only; route guards live in the
 * layouts and actions.
 *
 * Only routes that exist are listed. `/how-it-works`, `/pricing`, `/faq` and
 * the legal pages are Phase 10 work and were linked here before they were
 * built, so they 404'd; they come back when the pages do (PROGRESS). The same
 * goes for the student's `/dashboard/settings`.
 */
export const publicNav: { label: string; href: string }[] = [
  { label: "Find tutors", href: "/tutors" },
  { label: "Live now", href: "/live" },
];

/** Order is the design overhaul's: the things a student does most, first. */
export const studentNav: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Bookings", href: "/dashboard/bookings", icon: CalendarDays },
  { label: "Messages", href: "/dashboard/messages", icon: MessageSquare },
  { label: "Wallet", href: "/dashboard/wallet", icon: Wallet },
  { label: "Favourites", href: "/dashboard/favourites", icon: Heart },
];

/**
 * Tutor order: the daily loop first (Today, Bookings, Messages, Availability,
 * Earnings), then a divider, then the things visited now and then. Messages
 * moved up from ninth: a tutor who misses a message loses the booking.
 */
export const tutorNav: NavItem[] = [
  { label: "Today", href: "/tutor", icon: Home },
  { label: "Bookings", href: "/tutor/bookings", icon: CalendarDays },
  { label: "Messages", href: "/tutor/messages", icon: MessageSquare },
  { label: "Availability", href: "/tutor/availability", icon: Clock },
  { label: "Earnings", href: "/tutor/earnings", icon: TrendingUp },
  { label: "Withdrawals", href: "/tutor/withdrawals", icon: Banknote, groupStart: true },
  { label: "Broadcasts", href: "/tutor/broadcasts", icon: Radio },
  { label: "Profile", href: "/tutor/profile", icon: UserRound },
  { label: "Settings", href: "/tutor/settings", icon: Settings },
];

export const adminNav: NavItem[] = [
  { label: "Overview", href: "/admin", icon: Home },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Tutors", href: "/admin/tutors", icon: GraduationCap },
  { label: "Bookings", href: "/admin/bookings", icon: CalendarDays },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Withdrawals", href: "/admin/withdrawals", icon: Banknote },
  { label: "Subjects", href: "/admin/subjects", icon: BookOpen },
  { label: "Settings", href: "/admin/settings", icon: Settings },
  { label: "Audit log", href: "/admin/audit", icon: ScrollText },
];

export type Role = "student" | "tutor" | "admin";

export const navByRole: Record<Role, NavItem[]> = {
  student: studentNav,
  tutor: tutorNav,
  admin: adminNav,
};

/**
 * The mobile bottom bar (design overhaul Part 2): four destinations plus More,
 * which opens the drawer holding the full list. Four and not five because the
 * fifth is always "the one you forget", and 360px has room for five 44px
 * targets only by shrinking the labels past reading size.
 */
export const mobileNavByRole: Record<Role, NavItem[]> = {
  student: studentNav.filter((i) =>
    ["/dashboard", "/dashboard/bookings", "/dashboard/messages", "/dashboard/wallet"].includes(i.href),
  ),
  tutor: tutorNav.filter((i) =>
    ["/tutor", "/tutor/bookings", "/tutor/messages", "/tutor/earnings"].includes(i.href),
  ),
  admin: adminNav.filter((i) =>
    ["/admin", "/admin/tutors", "/admin/withdrawals", "/admin/users"].includes(i.href),
  ),
};

/** The fifth item in the bottom bar. Not a route: it opens the nav drawer. */
export const moreNavItem = { label: "More", icon: MoreHorizontal } as const;

export const roleHome: Record<Role, string> = {
  student: "Student",
  tutor: "Tutor",
  admin: "Admin",
};

/**
 * The account menu under the avatar. Only routes that exist are listed: the
 * student has no profile or settings page yet (Phase 10), so their menu is
 * Log out alone rather than two links that 404.
 */
export const accountLinksByRole: Record<Role, { label: string; href: string }[]> = {
  student: [],
  tutor: [
    { label: "Profile", href: "/tutor/profile" },
    { label: "Settings", href: "/tutor/settings" },
  ],
  admin: [{ label: "Settings", href: "/admin/settings" }],
};

/** Where the topbar's and bottom bar's Messages link goes. Admins have no inbox. */
export const messagesHrefByRole: Record<Role, string | undefined> = {
  student: "/dashboard/messages",
  tutor: "/tutor/messages",
  admin: undefined,
};
