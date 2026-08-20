import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our custom §10.1 type scale. Without this, tailwind-merge
// mistakes size tokens like `text-h2`/`text-body` for text-COLOR utilities and
// silently drops the colour when both are combined (e.g. `cn("text-white",
// s.amount)` collapsed to just `text-h2`, so ink numerals fell back to inherited
// black). Registering them as `font-size` keeps colour and size independent.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "h1",
            "h2",
            "h3",
            "body-lg",
            "body",
            "small",
            "caption",
          ],
        },
      ],
    },
  },
});

/**
 * Merge class names, resolving Tailwind conflicts (last one wins).
 * The single className helper used by every UI primitive.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
