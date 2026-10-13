"use client";

import * as React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { PHOTO_SHAPES, previewStyle, type CropArea, type PhotoShape } from "@/lib/images/crop";

/**
 * The crop step (avatar-crop, 2026-10-13). The photo sits inside the frame
 * the site will use (the tutor card's 16:10, or a square for students); the
 * person drags and zooms it, and two previews drawn from the same crop show
 * the card and the round avatar as students will see them. Nothing is
 * uploaded until they press "Use this photo".
 */
export function PhotoCropModal({
  src,
  shape,
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  /** A data URL of the chosen file; null closes the modal. */
  src: string | null;
  shape: PhotoShape;
  name: string;
  busy: boolean;
  onConfirm: (area: CropArea) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState<CropArea | null>(null);
  const [imageSize, setImageSize] = React.useState<{ width: number; height: number } | null>(null);
  const spec = PHOTO_SHAPES[shape];

  // Fresh state for every file.
  React.useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setImageSize(null);
  }, [src]);

  const CARD_W = 220;
  const CARD_H = Math.round(CARD_W / spec.aspect);
  const ROUND = 72;

  const cardPreview = area && imageSize ? previewStyle(area, imageSize.width, imageSize.height, CARD_W, CARD_H) : null;
  // The round avatar takes the centre square of what is stored.
  const roundArea: CropArea | null = area
    ? area.width >= area.height
      ? { x: area.x + (area.width - area.height) / 2, y: area.y, width: area.height, height: area.height }
      : { x: area.x, y: area.y + (area.height - area.width) / 2, width: area.width, height: area.width }
    : null;
  const roundPreview = roundArea && imageSize ? previewStyle(roundArea, imageSize.width, imageSize.height, ROUND, ROUND) : null;

  return (
    <Modal open={src !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <ModalContent size="lg" hideClose>
        <ModalHeader>
          <ModalTitle>Fit your photo</ModalTitle>
          <ModalDescription>
            Drag and zoom until your face sits in the frame. This is exactly how {spec.label} will look.
          </ModalDescription>
        </ModalHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="relative h-[320px] w-full overflow-hidden rounded-lg bg-ink">
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={spec.aspect}
                cropShape={shape === "avatar" ? "round" : "rect"}
                showGrid={false}
                minZoom={1}
                maxZoom={4}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_: Area, pixels: Area) => setArea(pixels)}
                onMediaLoaded={(m) => setImageSize({ width: m.naturalWidth, height: m.naturalHeight })}
              />
            )}
          </div>

          <div className="flex flex-col gap-3 md:w-[220px]">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">As students see it</p>
            {shape === "card" && (
              <div
                className="relative overflow-hidden rounded-photo bg-surface-muted"
                style={{ width: CARD_W, height: CARD_H }}
                aria-label="Card preview"
              >
                {src && cardPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="absolute max-w-none" style={cardPreview} />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-ink/75 px-2 py-1 text-[12px] font-semibold text-on-ink">
                  {name || "Your name"}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div
                className="relative shrink-0 overflow-hidden rounded-full bg-surface-muted"
                style={{ width: ROUND, height: ROUND }}
                aria-label="Avatar preview"
              >
                {src && roundPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="absolute max-w-none" style={roundPreview} />
                )}
              </div>
              <p className="text-small text-text-muted">Messages, bookings and the top bar use this round version.</p>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="photo-zoom">Zoom</Label>
          <input
            id="photo-zoom"
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Choose another
          </Button>
          <Button type="button" loading={busy} disabled={!area} onClick={() => area && onConfirm(area)}>
            Use this photo
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
