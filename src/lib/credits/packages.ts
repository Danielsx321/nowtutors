/**
 * Credit packages — the buyable tiers in `platform_settings.credit_packages`
 * (SPEC §4.7, §18 item 7).
 *
 * Pure and DB-free on purpose: the PayPal order route must resolve a package
 * *server-side* from an id the client sends and never accept a client amount
 * (SPEC §7.6), and that resolution is the thing worth unit-testing. The DB read
 * lives in `lib/settings.ts` (`getCreditPackages`), which hands the raw jsonb to
 * `parseCreditPackages` here.
 *
 * A credit is a purchased currency, not a unit of time — there is no
 * credit-to-USD rate and no credit-to-minutes ratio (credits-are-money
 * amendment, docs/DECISIONS.md). Each tier stands on its own credits + price.
 */

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceUsd: number;
}

/** Raised when a client sends a packageId that isn't a live package. */
export class UnknownCreditPackageError extends Error {
  readonly code = "unknown_package" as const;
  constructor(readonly packageId: string) {
    super("That credit package isn't available.");
    this.name = "UnknownCreditPackageError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A positive, finite number, or null. Rejects NaN/Infinity/strings. */
function positiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Coerce the `credit_packages` jsonb into typed packages, dropping any row that
 * isn't a complete, sane tier. Settings are admin-editable, so a malformed or
 * half-saved row must never reach a PayPal order as a zero/NaN amount — it
 * disappears instead, and an unknown id then fails loud in the route.
 */
export function parseCreditPackages(value: unknown): CreditPackage[] {
  if (!Array.isArray(value)) return [];
  const out: CreditPackage[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || seen.has(id)) continue;
    // Credits are whole units; a fractional package would round badly forever.
    const credits = positiveNumber(raw.credits);
    if (credits === null || !Number.isInteger(credits)) continue;
    const priceUsd = positiveNumber(raw.price_usd);
    if (priceUsd === null) continue;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    seen.add(id);
    out.push({ id, name, credits, priceUsd });
  }
  return out;
}

/** The package with this id, or null. Ids are matched exactly, never fuzzily. */
export function findCreditPackage(
  packages: readonly CreditPackage[],
  packageId: string,
): CreditPackage | null {
  return packages.find((p) => p.id === packageId) ?? null;
}

/**
 * Resolve the id the client sent to a real package, or throw. This is the
 * "never trust a client amount" boundary: the route sends `pkg.priceUsd` to
 * PayPal and grants `pkg.credits`, both read from settings, never from input.
 */
export function requireCreditPackage(
  packages: readonly CreditPackage[],
  packageId: string,
): CreditPackage {
  const pkg = findCreditPackage(packages, packageId);
  if (!pkg) throw new UnknownCreditPackageError(packageId);
  return pkg;
}

/** PayPal wants `amount.value` as a 2-decimal string ("9.99"), never a number. */
export function toPayPalAmount(priceUsd: number): string {
  return priceUsd.toFixed(2);
}
