/**
 * Photo crop on upload (avatar-crop, 2026-10-13). The tutor card is a 16:10
 * frame (`tutor-card.tsx`) and the round avatar takes the centre of whatever is
 * stored, so a tutor crops to the card and gets both right; a student, whose
 * only surface is the round avatar, crops to a square. One image is stored
 * either way, at a size that is sharp on a 4K grid and small on the wire.
 */
export const PHOTO_SHAPES = {
  card: { aspect: 16 / 10, width: 1200, height: 750, label: "your tutor card" },
  avatar: { aspect: 1, width: 600, height: 600, label: "your profile picture" },
} as const;

export type PhotoShape = keyof typeof PHOTO_SHAPES;

/** The crop area react-easy-crop reports, in source-image pixels. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const JPEG_QUALITY = 0.86;

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open the image."));
    img.src = src;
  });
}

/**
 * Draw the chosen area onto a canvas at the shape's output size and return a
 * JPEG blob. The area is clamped to the image so a crop that touches an edge
 * never samples outside it.
 */
export async function cropImageToBlob(src: string, area: CropArea, shape: PhotoShape): Promise<Blob> {
  const { width, height } = PHOTO_SHAPES[shape];
  const img = await loadImage(src);
  const clamped = clampArea(area, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, clamped.x, clamped.y, clamped.width, clamped.height, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the image."))), "image/jpeg", JPEG_QUALITY);
  });
}

/** Keep the crop inside the image, preserving its size where it fits. */
export function clampArea(area: CropArea, imageWidth: number, imageHeight: number): CropArea {
  const width = Math.min(Math.max(1, Math.round(area.width)), imageWidth);
  const height = Math.min(Math.max(1, Math.round(area.height)), imageHeight);
  const x = Math.min(Math.max(0, Math.round(area.x)), imageWidth - width);
  const y = Math.min(Math.max(0, Math.round(area.y)), imageHeight - height);
  return { x, y, width, height };
}

/**
 * The CSS that shows the chosen area inside a preview box of `boxWidth` ×
 * `boxHeight`, without drawing: scale the whole image so the area fills the
 * box and shift it so the area's corner sits at the box's corner. Used for the
 * live card and round previews while the tutor drags.
 */
export function previewStyle(
  area: CropArea,
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number; left: number; top: number } {
  if (area.width <= 0 || area.height <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { width: boxWidth, height: boxHeight, left: 0, top: 0 };
  }
  const scale = boxWidth / area.width;
  return {
    width: imageWidth * scale,
    height: imageHeight * scale,
    left: -area.x * scale,
    top: -area.y * scale,
  };
}
