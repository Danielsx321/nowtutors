// Canonical language options (Bubble option set, Phase 3). Used both as tutor
// `languages` values and as the browse language-filter options.
export const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "Mandarin",
  "German",
  "Hindi",
  "Arabic",
  "Portuguese",
  "Other",
] as const;

export type Language = (typeof LANGUAGES)[number];
