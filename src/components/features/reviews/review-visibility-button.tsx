"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setReviewPublished } from "@/actions/reviews";

/** Hide / Show on /admin/reviews. The server action re-checks the admin role. */
export function ReviewVisibilityButton({ reviewId, published }: { reviewId: string; published: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        size="sm"
        variant={published ? "outline" : "ghost"}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setReviewPublished({ reviewId, published: !published });
            if ("error" in res) setError(res.error);
            else {
              setError(null);
              router.refresh();
            }
          })
        }
      >
        {published ? "Hide" : "Show"}
      </Button>
      {error && <span className="text-caption text-danger">{error}</span>}
    </div>
  );
}
