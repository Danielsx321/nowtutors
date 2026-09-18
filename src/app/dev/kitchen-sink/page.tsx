"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { type Surface } from "./_sections/kit";
import { FoundationsSection } from "./_sections/foundations";
import { SignalSection } from "./_sections/signal";
import { ButtonsSection } from "./_sections/buttons";
import { FormsSection } from "./_sections/forms";
import { FeedbackSection } from "./_sections/feedback";
import { DataDisplaySection } from "./_sections/data-display";
import { TutorCardSection } from "./_sections/tutor-card";
import { LiveMomentsSection } from "./_sections/live-moments";
import { AuthSection } from "./_sections/auth";
import { OverlaysSection } from "./_sections/overlays";
import { LayoutsPreviewSection } from "./_sections/layouts-preview";
import { DashboardSection } from "./_sections/dashboard";

const sections = [
  { id: "foundations", label: "Tokens" },
  { id: "signal", label: "Live signal" },
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Forms" },
  { id: "feedback", label: "Feedback" },
  { id: "data-display", label: "Data display" },
  { id: "tutor-card", label: "TutorCard" },
  { id: "live-moments", label: "Live moments" },
  { id: "auth", label: "Auth" },
  { id: "overlays", label: "Overlays" },
  { id: "layouts", label: "Layouts" },
  { id: "dashboard", label: "Dashboard" },
];

export default function KitchenSink() {
  const [surface, setSurface] = React.useState<Surface>("light");

  return (
    <div className={cn("min-h-screen bg-surface text-text transition-colors", surface === "dark" && "theme-dark")}>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div>
            <h1 className="font-display text-h3 font-semibold text-text">Kitchen Sink</h1>
            <p className="text-caption text-text-muted">
              Every §10.2 primitive, in every state, in both themes.
            </p>
          </div>

          {/* Theme toggle: `dark` wraps the page in `.theme-dark`, the scope the
              live rooms use, so every primitive is checked on both palettes. */}
          <div
            role="group"
            aria-label="Preview theme"
            className="inline-flex rounded-full border border-border bg-surface-raised p-1"
          >
            {(["light", "dark"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={surface === s}
                onClick={() => setSurface(s)}
                className={cn(
                  "focus-ring rounded-full px-4 py-1.5 text-small font-medium capitalize transition-colors",
                  surface === s ? "bg-primary text-on-primary" : "text-text-muted hover:text-text",
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
              className="focus-ring rounded-sm text-small text-text-muted hover:text-accent hover:underline"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="w-full space-y-16 px-4 py-12 md:px-6">
        <FoundationsSection surface={surface} />
        <SignalSection surface={surface} />
        <ButtonsSection surface={surface} />
        <FormsSection surface={surface} />
        <FeedbackSection surface={surface} />
        <DataDisplaySection surface={surface} />
        <TutorCardSection surface={surface} />
        <LiveMomentsSection surface={surface} />
        <AuthSection surface={surface} />
        <OverlaysSection surface={surface} />
        <LayoutsPreviewSection surface={surface} />
        <DashboardSection surface={surface} />
      </main>
    </div>
  );
}
