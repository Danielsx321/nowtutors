"use client";

import * as React from "react";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cropImageToBlob, readFileAsDataUrl, type CropArea, type PhotoShape } from "@/lib/images/crop";
import { PhotoCropModal } from "./photo-crop-modal";

/**
 * Uploads an avatar to the public `avatars` bucket under `{uid}/…` (the storage
 * policy from drizzle/0007 only allows a user to write inside their own folder),
 * then reports the public URL. Optional — a student can skip it.
 *
 * Since avatar-crop (2026-10-13) the file goes through `PhotoCropModal` first:
 * the person fits it inside the frame the site will show (`shape`: the tutor
 * card's 16:10, or a square for students) and sees the result before anything
 * is uploaded. What is stored is the cropped JPEG, never the original.
 */
export function AvatarUpload({
  userId,
  name,
  value,
  onChange,
  shape = "avatar",
}: {
  userId: string;
  name: string;
  value?: string;
  onChange: (url: string | undefined) => void;
  /** Which frame the person crops to. Tutors: `card`. Students: `avatar`. */
  shape?: PhotoShape;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingSrc, setPendingSrc] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same file be chosen again after a cancel.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10 MB.");
      return;
    }
    setError(null);
    try {
      setPendingSrc(await readFileAsDataUrl(file));
    } catch {
      setError("Could not open that image. Try another.");
    }
  }

  async function onConfirm(area: CropArea) {
    if (!pendingSrc) return;
    setBusy(true);
    try {
      const blob = await cropImageToBlob(pendingSrc, area, shape);
      const supabase = createClient();
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      onChange(data.publicUrl);
      setPendingSrc(null);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar src={value} name={name || "You"} size="lg" />
      <div className="space-y-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera aria-hidden />
          {value ? "Change photo" : "Upload photo"}
        </Button>
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
      <PhotoCropModal
        src={pendingSrc}
        shape={shape}
        name={name}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => {
          setPendingSrc(null);
          inputRef.current?.click();
        }}
      />
    </div>
  );
}
