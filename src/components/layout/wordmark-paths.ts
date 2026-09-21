/**
 * Vector outlines of the NowTutors logo (DESIGN.md, "Wordmark"). Traced from
 * Noora's own "tutornow" artwork and re-set as "nowtutors" with a matching
 * "s", approved 2026-09-16 (DECISIONS, "Design overhaul: Noora's answers").
 * Generated, not hand-edited: the source SVGs live outside the repo in the
 * workspace (outputs/nowtutors-logo/).
 */

/** viewBox of the full logo, tight to the ink. */
export const WORDMARK_VIEWBOX = "1 12.75 1058 163.25";

/**
 * The full "nowtutors" outline is NOT here. It is a 34 KB path, and inline it
 * shipped four times in every page. It lives in one static, cached file,
 * `public/brand/wordmark.v1.svg`, which `<Wordmark />` paints as a mask
 * (DECISIONS, "Performance review: the logo"). A new outline gets a new file
 * name, because the file is served as immutable.
 */

/** viewBox of the "n" alone, square, for the collapsed sidebar rail. */
export const MONOGRAM_VIEWBOX = "-4 52 118 118";

/** The logo's own "n", for the collapsed sidebar rail. */
export const MONOGRAM_PATH =
  "M16.9 168.7 C14.1 168.6 9.7 168.6 6.9 168.5 C2.4 168.5 2 168.5 1.5 168 C1 167.5 1 167.3 1.1 136.6 C1.2 119.5 1.4 94.9 1.5 81.8 C1.8 59.9 1.9 58 2.3 57.6 C2.6 57.3 4.5 57.2 18.4 57.2 C28.4 57.2 34.2 57.4 34.5 57.5 C35 57.8 35 58.2 35.1 64.9 C35.1 71.2 35.2 72.1 35.5 72.2 C35.8 72.2 36.5 71.4 37.6 70 C39.8 67 44 62.8 46.4 61.3 C48.7 59.8 49 59.6 49.8 59.2 C50.1 59.1 50.5 58.9 50.8 58.7 C51 58.6 51.4 58.4 51.8 58.2 C52.1 58.1 52.7 57.8 53.1 57.6 C53.5 57.4 54.3 57.1 54.9 57 C55.4 56.9 56.3 56.6 56.9 56.4 C57.4 56.2 58.4 56 59.1 56 C59.7 56 60.6 55.8 61 55.6 C62.1 55.1 69.1 54.8 72.1 55.2 C77.3 55.9 79 56.2 81.8 56.9 C84.4 57.6 85.2 58 87.4 59.2 C87.8 59.5 88.4 59.8 88.7 59.9 C90.5 60.4 95.9 65 97.4 67.1 C97.8 67.8 98.5 68.8 98.9 69.4 C100.1 71 101 72.7 101 73.2 C101 73.4 101.2 74 101.5 74.4 C101.8 74.8 102 75.3 102 75.6 C102 75.8 102.2 76.5 102.5 77 C102.8 77.5 103 78.3 103 78.8 C103 79.2 103.2 80.1 103.5 80.7 C103.8 81.3 104 82.3 104 83 C104 83.6 104.2 84.8 104.5 85.7 C105 87.2 105 88 105 105.8 C105 130.5 104.5 168.3 104.2 168.7 C104 168.9 100.5 169 87.5 168.9 L71.1 168.9L71.1 131.2 C71.1 110.6 71 93 70.9 92.2 C70.8 91.4 70.6 90.6 70.4 90.3 C70.2 90.1 70 89.6 70 89.2 C70 88.4 68.9 86.2 68.4 85.9 C68.2 85.8 68 85.6 68 85.4 C68 84.9 66.3 83 65.8 83 C65.7 83 65.3 82.8 65.1 82.5 C64.8 82.2 64.5 82 64.3 82 C64 82 63.6 81.8 63.2 81.5 C62.9 81.2 62.3 81 61.9 81 C61.5 81 60.5 80.8 59.7 80.6 C57.8 80.2 56.4 80.2 55 80.6 C54.4 80.8 53.3 81 52.5 81 C51.5 81 50.9 81.1 50.4 81.5 C50.1 81.8 49.5 82 49.2 82 C48.9 82 48.4 82.2 48.1 82.5 C47.9 82.8 47.4 83 47.1 83 C46.2 83 40 89.2 39.3 90.8 C39 91.4 38.6 92.1 38.4 92.3 C38.2 92.4 38 92.8 38 93.2 C38 93.5 37.8 94.1 37.5 94.4 C37.2 94.8 37 95.5 37 96.1 C37 96.8 36.8 97.4 36.5 97.8 C36.1 98.3 36 98.8 36 100.3 C36 101.5 35.8 102.6 35.6 103.3 C35.2 104.3 35.1 106.5 35 125.5 C34.7 157.2 34.5 168.2 34.1 168.6 C33.7 169 27.3 169 16.9 168.7 Z";
