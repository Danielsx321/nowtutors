import { describe, expect, it } from "vitest";
import {
  COUNTRY_CENTROIDS,
  MAX_GLOBE_MARKERS,
  countryName,
  toGlobeMarkers,
} from "@/lib/geo/country-centroids";

describe("COUNTRY_CENTROIDS", () => {
  it("keys are ISO alpha-2 and every point is a real lat/lng", () => {
    for (const [code, [lat, lng]] of Object.entries(COUNTRY_CENTROIDS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    }
  });

  it("covers every country the seed data uses", () => {
    for (const code of ["US", "ES", "CN", "EG", "BR", "IN", "FR", "PK", "NG", "GB"]) {
      expect(COUNTRY_CENTROIDS[code]).toBeTruthy();
    }
  });

  it("puts a few capitals where they are (hemisphere check)", () => {
    expect(COUNTRY_CENTROIDS.NG).toEqual([9.1, 7.5]); // Abuja: north, east
    expect(COUNTRY_CENTROIDS.BR![0]).toBeLessThan(0); // Brasília: south
    expect(COUNTRY_CENTROIDS.US![1]).toBeLessThan(0); // Washington: west
  });
});

describe("toGlobeMarkers", () => {
  it("maps codes to points, case-insensitively", () => {
    expect(toGlobeMarkers(["gh", " NG "])).toEqual([
      { lat: 5.6, lng: -0.2 },
      { lat: 9.1, lng: 7.5 },
    ]);
  });

  it("drops unknown, empty and missing codes rather than guessing", () => {
    expect(toGlobeMarkers(["ZZ", "", null, undefined, "Nigeria", "IT"])).toEqual([
      { lat: 41.9, lng: 12.5 },
    ]);
  });

  it("deduplicates: two tutors in one country are one dot", () => {
    expect(toGlobeMarkers(["GH", "gh", "GH"])).toHaveLength(1);
  });

  it("caps the number of dots", () => {
    const all = Object.keys(COUNTRY_CENTROIDS);
    expect(all.length).toBeGreaterThan(MAX_GLOBE_MARKERS);
    expect(toGlobeMarkers(all)).toHaveLength(MAX_GLOBE_MARKERS);
  });

  it("returns nothing for nobody live", () => {
    expect(toGlobeMarkers([])).toEqual([]);
  });
});

describe("countryName", () => {
  it("names a code in English and passes nulls through", () => {
    expect(countryName("GH")).toBe("Ghana");
    expect(countryName("it")).toBe("Italy");
    expect(countryName(null)).toBeNull();
  });
});
