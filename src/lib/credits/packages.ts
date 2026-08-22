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
  /**
   * Marks the one tier whose per-credit price is the **direct-pay basis**
   * (SPEC §4.4, §7.6). Exactly one package must carry it — see
   * {@link requireDirectPayBasisPackage}.
   */
  isDirectPayBasis: boolean;
}

/** Raised when a client sends a packageId that isn't a live package. */
export class UnknownCreditPackageError extends Error {
  readonly code = "unknown_package" as const;
  constructor(readonly packageId: string) {
    super("That credit package isn't available.");
    this.name = "UnknownCreditPackageError";
  }
}

/**
 * Raised when the direct-pay basis is not exactly one package. Deliberately
 * fatal: a mispriced direct-pay charge must surface as an error, never as a
 * wrong amount (SPEC §3.3, no silent failures).
 */
export class DirectPayBasisError extends Error {
  readonly code = "direct_pay_basis" as const;
  constructor(readonly found: number) {
    super(
      `Direct-pay basis must be exactly one credit package; found ${found}.`,
    );
    this.name = "DirectPayBasisError";
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
    out.push({
      id,
      name,
      credits,
      priceUsd,
      isDirectPayBasis: raw.is_direct_pay_basis === true,
    });
  }
  return out;
}

/**
 * The package whose per-credit price prices a direct-pay booking (SPEC §7.6).
 *
 * Resolved from an explicit flag on the package, never by array index or by
 * picking the median at runtime, so retuning direct-pay is a **settings edit**
 * (move the flag to another tier) and never a code change.
 *
 * Throws when zero or more than one package is flagged. There is no fallback
 * tier and no "first match wins": either the basis is unambiguous or the charge
 * does not happen.
 */
export function requireDirectPayBasisPackage(
  packages: readonly CreditPackage[],
): CreditPackage {
  const flagged = packages.filter((p) => p.isDirectPayBasis);
  if (flagged.length !== 1) throw new DirectPayBasisError(flagged.length);
  return flagged[0];
}

/**
 * USD **cents** for a direct-pay booking of `priceCredits`, at the basis tier's
 * per-credit price, **rounded up** so a fractional cent never rounds in the
 * buyer's favour against the platform.
 *
 * Computed in integer cents throughout: `credits × basisCents / basisCredits`
 * as floats reintroduces binary-float error (30 × 39.99 × 100 / 30 lands on
 * 3999.000000000001 and would ceil to $40.00 instead of $39.99).
 */
export function directPayUsdCents(
  priceCredits: number,
  basis: CreditPackage,
): number {
  if (!Number.isInteger(priceCredits) || priceCredits <= 0) {
    throw new Error("Direct-pay credits must be a positive integer.");
  }
  const basisCents = Math.round(basis.priceUsd * 100);
  return Math.ceil((priceCredits * basisCents) / basis.credits);
}

/** `directPayUsdCents` as PayPal's 2-decimal string. */
export function directPayAmount(
  priceCredits: number,
  basis: CreditPackage,
): string {
  return (directPayUsdCents(priceCredits, basis) / 100).toFixed(2);
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
