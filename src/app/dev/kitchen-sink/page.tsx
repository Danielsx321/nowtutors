"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Surface } from "./_sections/kit";
import { ButtonsSection } from "./_sections/buttons";
import { FormsSection } from "./_sections/forms";
import { FeedbackSection } from "./_sections/feedback";
import { DataDisplaySection } from "./_sections/data-display";
import { OverlaysSection } from "./_sections/overlays";
import { LayoutsPreviewSection } from "./_sections/layouts-preview";

const sections = [
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Forms" },
  { id: "feedback", label: "Feedback" },
  { id: "data-display", label: "Data display" },
  { id: "overlays", label: "Overlays" },
  { id: "layouts", label: "Layouts" },
];

export default function KitchenSink() {
  const [surface, setSurface] = React.useState<Surface>("light");

  return (
    <div
      className={cn(
        "min-h-screen transition-colors",
        surface === "ink" ? "bg-ink-900" : "bg-gray-50",
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-30 border-b backdrop-blur",
          surface === "ink"
            ? "border-ink-800 bg-ink-900/90"
            : "border-gray-200 bg-white/90",
        )}
      >
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <h1
              className={cn(
                "text-h3 font-bold",
                surface === "ink" ? "text-white" : "text-gray-700",
              )}
            >
              Kitchen Sink
            </h1>
            <p
              className={cn(
                "text-caption",
                surface === "ink" ? "text-gray-200" : "text-gray-500",
              )}
            >
              Every §10.2 primitive, in every state.
            </p>
          </div>

          {/* Surface toggle — amendment #1: verify each primitive on both a
              light surface and ink-900. */}
          <div
            role="group"
            aria-label="Preview surface"
            className={cn(
              "inline-flex rounded-full border p-1",
              surface === "ink" ? "border-ink-800 bg-ink-800" : "border-gray-200 bg-white",
            )}
          >
            {(["light", "ink"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={surface === s}
                onClick={() => setSurface(s)}
                className={cn(
                  "focus-ring rounded-full px-4 py-1.5 text-small font-medium capitalize transition-colors",
                  surface === s
                    ? "bg-purple-500 text-white"
                    : surface === "ink"
                      ? "text-gray-200"
                      : "text-gray-500",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <nav className="container-page flex flex-wrap gap-x-4 gap-y-1 pb-3">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                "focus-ring rounded-sm text-small hover:underline",
                surface === "ink" ? "text-gray-200" : "text-gray-500",
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="container-page space-y-16 py-12">
        <ButtonsSection surface={surface} />
        <FormsSection surface={surface} />
        <FeedbackSection surface={surface} />
        <DataDisplaySection surface={surface} />
        <OverlaysSection surface={surface} />
        <LayoutsPreviewSection surface={surface} />
      </main>
    </div>
  );
}
