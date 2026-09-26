import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Design smoke (live-globe rebuild Part I, plan Step 10; round 3 Part C adds the sidebar checks).
 *
 * Not a behaviour test: it asserts the v2 shell is there on every key page at
 * the two widths the rebuild was designed for, and that nothing makes the page
 * scroll sideways. Public pages: site header, full footer, an h1. Signed-in
 * dashboards: the sidebar at 1440 (the bottom bar at 360) and the dashboard
 * banner. Screenshots land in test-results/design/ for the before/after set.
 *
 * Reads only. Uses the seeded fixture accounts, like the other specs.
 */

const PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
const TUTOR_SLUG = process.env.E2E_TUTOR_SLUG ?? "tom-turner";
const WIDTHS = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "360", viewport: { width: 360, height: 800 } },
] as const;

const PUBLIC_PAGES = [
  { name: "home", path: "/" },
  { name: "browse", path: "/tutors" },
  { name: "profile", path: `/tutors/${TUTOR_SLUG}` },
  { name: "live", path: "/live" },
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "not-found", path: "/this-page-does-not-exist" },
];

const DASHBOARDS = [
  { name: "student", email: "student1@nowtutors.dev", path: "/dashboard", landing: /\/dashboard(\/|$)/ },
  { name: "tutor", email: "tutor1@nowtutors.dev", path: "/tutor", landing: /\/tutor(\/|$)/ },
  { name: "admin", email: "admin@nowtutors.dev", path: "/admin", landing: /\/admin(\/|$)/ },
];

async function noSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
}

async function shot(page: Page, file: string) {
  await page.screenshot({ path: `test-results/design/${file}.png`, fullPage: true });
}

for (const w of WIDTHS) {
  test.describe(`design smoke at ${w.name}`, () => {
    test.use({ viewport: w.viewport });

    for (const p of PUBLIC_PAGES) {
      test(`public ${p.name}: header, footer, heading, no sideways scroll`, async ({ page }) => {
        await page.goto(p.path, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("banner").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("contentinfo")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        if (p.name === "profile") {
          // Round 3 Part E: the profile opens on the stage.
          await expect(page.locator("[data-stage]")).toBeVisible();
        }
        if (p.name === "browse" || p.name === "home") {
          // Round 3 Part C: the sidebar filters from lg, the chip row below it.
          const sidebar = page.getByRole("navigation", { name: "Filters" });
          const chips = page.locator("[data-filter-chips]");
          if (w.viewport.width >= 1024) {
            await expect(sidebar).toBeVisible();
            await expect(chips).toBeHidden();
          } else {
            await expect(sidebar).toBeHidden();
            await expect(chips).toBeVisible();
          }
        }
        await noSidewaysScroll(page, `${p.path} at ${w.name}`);
        await shot(page, `${w.name}-${p.name}`);
      });
    }

    for (const d of DASHBOARDS) {
      test(`signed in ${d.name}: navigation and banner, no sideways scroll`, async ({ browser }) => {
        const page = await signedIn(browser, d.email, d.landing, w.viewport);
        await page.goto(d.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-dashboard-banner]").first()).toBeVisible({ timeout: 30_000 });
        // One "Primary" nav is visible at each width: the sidebar's from lg, the bottom bar's below md.
        const primary = page.getByRole("navigation", { name: "Primary" });
        await expect(primary.filter({ visible: true }).first()).toBeVisible();
        await noSidewaysScroll(page, `${d.path} at ${w.name}`);
        await shot(page, `${w.name}-${d.name}-dashboard`);
        await page.context().close();
      });
    }
  });
}

async function signedIn(
  browser: Browser,
  email: string,
  landing: RegExp,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
  return page;
}
