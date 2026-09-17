/**
 * Every route the app actually serves, in one place.
 *
 * SPEC §10.3: navigation may not link to a route that does not exist. That rule
 * was broken twice before (a footer full of `/pricing`, `/faq` and legal links
 * that 404'd), so it is a list a test can read rather than a promise. The site
 * footer's own test asserts that every `href` it renders is in here.
 *
 * Dynamic routes are matched by prefix (`/tutors/[slug]` is `/tutors/`), which
 * is enough for navigation: nothing in a header or footer links into a dynamic
 * segment.
 */
export const EXISTING_ROUTES = [
  // Public
  "/",
  "/tutors",
  "/live",
  // Auth
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  // Post-auth, no role yet
  "/onboarding",
  "/suspended",
  // Student
  "/dashboard",
  "/dashboard/bookings",
  "/dashboard/messages",
  "/dashboard/wallet",
  "/dashboard/favourites",
  // Tutor
  "/tutor",
  "/tutor/bookings",
  "/tutor/availability",
  "/tutor/broadcasts",
  "/tutor/earnings",
  "/tutor/messages",
  "/tutor/profile",
  "/tutor/settings",
  "/tutor/withdrawals",
  "/tutor/pending-approval",
  // Admin
  "/admin",
  "/admin/audit",
  "/admin/bookings",
  "/admin/payments",
  "/admin/settings",
  "/admin/subjects",
  "/admin/tutors",
  "/admin/users",
  "/admin/withdrawals",
] as const;

export type ExistingRoute = (typeof EXISTING_ROUTES)[number];

/**
 * Is this href something the app serves? Accepts a query string or a hash on a
 * real route (`/tutors?live=1`, `/#how`), since both resolve to a page that
 * exists.
 */
export function isExistingRoute(href: string): boolean {
  if (!href.startsWith("/")) return false;
  const path = href.split(/[?#]/)[0] || "/";
  return (EXISTING_ROUTES as readonly string[]).includes(path);
}
