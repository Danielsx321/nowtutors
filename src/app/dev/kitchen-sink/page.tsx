"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ring, type Surface } from "./_sections/kit";
import { FoundationsSection } from "./_sections/foundations";
import { ButtonsSection } from "./_sections/buttons";
import { FormsSection } from "./_sections/forms";
import { FeedbackSection } from "./_sections/feedback";
import { DataDisplaySection } from "./_sections/data-display";
import { TutorCardSection } from "./_sections/tutor-card";
import { AuthSection } from "./_sections/auth";
import { OverlaysSection } from "./_sections/overlays";
import { LayoutsPreviewSection } from "./_sections/layouts-preview";

const sections = [
  { id: "foundations", label: "Foundations" },
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Forms" },
  { id: "feedback", label: "Feedback" },
  { id: "data-display", label: "Data display" },
  { id: "tutor-card", label: "TutorCard" },
  { id: "auth", label: "Auth" },
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
            ? "border-ink-700 bg-ink-900/90"
            : "border-gray-200 bg-white/90",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
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
                surface === "ink" ? "text-ink-300" : "text-gray-500",
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
              surface === "ink" ? "border-ink-700 bg-ink-950" : "border-gray-200 bg-white",
            )}
          >
            {(["light", "ink"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={surface === s}
                onClick={() => setSurface(s)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-small font-medium capitalize transition-colors",
                  ring(surface),
                  surface === s
                    ? "bg-purple-500 text-white"
                    : surface === "ink"
                      ? "text-ink-300"
                      : "text-gray-500",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 md:px-6">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                "rounded-sm text-small hover:underline",
                ring(surface),
                surface === "ink" ? "text-ink-300" : "text-gray-500",
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="w-full space-y-16 px-4 py-12 md:px-6">
        <FoundationsSection surface={surface} />
        <ButtonsSection surface={surface} />
        <FormsSection surface={surface} />
        <FeedbackSection surface={surface} />
        <DataDisplaySection surface={surface} />
        <TutorCardSection surface={surface} />
        <AuthSection surface={surface} />
        <OverlaysSection surface={surface} />
        <LayoutsPreviewSection surface={surface} />
      </main>
    </div>
  );
}
