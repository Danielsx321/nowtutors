import { describe, expect, it } from "vitest";
import { PHOTO_SHAPES, clampArea, previewStyle } from "@/lib/images/crop";

/**
 * The pure half of the photo crop (avatar-crop): the shapes match the surfaces
 * they feed, a crop never samples outside the image, and the live preview's
 * CSS puts the chosen area exactly over the preview box.
 */
describe("photo shapes", () => {
  it("card is the tutor card's 16:10 and avatar is square", () => {
    expect(PHOTO_SHAPES.card.width / PHOTO_SHAPES.card.height).toBeCloseTo(16 / 10, 5);
    expect(PHOTO_SHAPES.card.aspect).toBeCloseTo(16 / 10, 5);
    expect(PHOTO_SHAPES.avatar.width).toBe(PHOTO_SHAPES.avatar.height);
    expect(PHOTO_SHAPES.avatar.aspect).toBe(1);
  });
});

describe("clampArea", () => {
  it("keeps a crop that fits where it is", () => {
    expect(clampArea({ x: 10, y: 20, width: 100, height: 50 }, 400, 300)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("pulls a crop back inside the image and never below one pixel", () => {
    expect(clampArea({ x: 350, y: -5, width: 100, height: 50 }, 400, 300)).toEqual({ x: 300, y: 0, width: 100, height: 50 });
    expect(clampArea({ x: 0, y: 0, width: 900, height: 900 }, 400, 300)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(clampArea({ x: 0, y: 0, width: 0, height: 0 }, 400, 300).width).toBe(1);
  });
});

describe("previewStyle", () => {
  it("scales the image so the crop fills the box and shifts the crop's corner to the box's corner", () => {
    const s = previewStyle({ x: 100, y: 50, width: 200, height: 125 }, 800, 600, 400, 250);
    expect(s).toEqual({ width: 1600, height: 1200, left: -200, top: -100 });
  });

  it("falls back to filling the box when there is no crop yet", () => {
    expect(previewStyle({ x: 0, y: 0, width: 0, height: 0 }, 800, 600, 400, 250)).toEqual({ width: 400, height: 250, left: 0, top: 0 });
  });
});
