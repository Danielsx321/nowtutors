import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
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
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Static navigation config from SPEC §6. Presentational only — route guards
 * that gate these areas by role land in Phase 3 (auth). No data here.
 */
export const publicNav: { label: string; href: string }[] = [
  { label: "Find tutors", href: "/tutors" },
  { label: "Live now", href: "/live" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/faq" },
];

export const studentNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Bookings", href: "/dashboard/bookings", icon: CalendarDays },
  { label: "Wallet", href: "/dashboard/wallet", icon: Wallet },
  { label: "Messages", href: "/dashboard/messages", icon: MessageSquare },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export const tutorNav: NavItem[] = [
  { label: "Overview", href: "/tutor", icon: LayoutDashboard },
  { label: "Bookings", href: "/tutor/bookings", icon: CalendarDays },
  { label: "Availability", href: "/tutor/availability", icon: Clock },
  { label: "Profile", href: "/tutor/profile", icon: UserRound },
  { label: "Earnings", href: "/tutor/earnings", icon: TrendingUp },
  { label: "Withdrawals", href: "/tutor/withdrawals", icon: Banknote },
  { label: "Broadcasts", href: "/tutor/broadcasts", icon: Radio },
  { label: "Messages", href: "/tutor/messages", icon: MessageSquare },
  { label: "Settings", href: "/tutor/settings", icon: Settings },
];

export const adminNav: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
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

export const roleHome: Record<Role, string> = {
  student: "Student",
  tutor: "Tutor",
  admin: "Admin",
};
