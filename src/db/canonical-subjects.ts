// The canonical subject list, shared by the dev/test seed and the production
// settings seed (Phase 10 Part 6), so the launch database gets exactly the
// subjects the app was built and tested against.

// Canonical 26 subjects (Bubble option set), in order → sort_order 1..26.
// #3/#11 corrected per the §18 resolution; #6/#10 confirmed correct as seeded (see DECISIONS.md).
export const SUBJECT_NAMES = [
  "Algebra",
  "Advanced Calculus",
  "English as a Second Language (ESL)",
  "Python Programming",
  "Physics",
  "IELTS / TOEFL Essay Proofreading",
  "Chemistry",
  "SAT / ACT Test Prep",
  "Statistics & Data Analysis",
  "Data Science & Machine Learning",
  "Live IELTS / TOEFL Speaking Prep",
  "Java & C++ Programming",
  "Financial Accounting",
  "Academic Essay Writing",
  "Spanish",
  "French",
  "Biology & Genetics",
  "GRE / GMAT Test Prep",
  "Web Development",
  "Macro / Microeconomics",
  "Arabic",
  "MCAT / LSAT Test Prep",
  "Geometry",
  "Mandarin Chinese",
  "Study Skills",
  "ACT Maths",
];

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const SUBJECTS = SUBJECT_NAMES.map((name, i) => ({
  name,
  slug: slugify(name),
  sort_order: i + 1,
}));
