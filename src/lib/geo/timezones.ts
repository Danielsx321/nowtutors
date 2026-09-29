/**
 * IANA time zones for the settings and onboarding forms (Phase 10 Part 4).
 *
 * Validity is decided by `Intl.DateTimeFormat`, not by membership of
 * `Intl.supportedValuesOf("timeZone")`: the list holds canonical names only,
 * and a browser may report a valid alias ("Asia/Calcutta"), which must still
 * be accepted. Pure, so it runs in the browser and on the server alike.
 */

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Canonical zones, "UTC" first, for a select. Falls back to a short list on an old runtime. */
export function timeZoneOptions(): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = ["Africa/Lagos", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "Europe/Paris"];
  }
  return ["UTC", ...zones.filter((z) => z !== "UTC")];
}

/** "Africa/Lagos" to "Africa / Lagos (GMT+1)" for the option label. */
export function timeZoneLabel(tz: string, at: Date = new Date()): string {
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    offset = "";
  }
  const name = tz.replace(/_/g, " ").replace(/\//g, " / ");
  return offset ? `${name} (${offset})` : name;
}
