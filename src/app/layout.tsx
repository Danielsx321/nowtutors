import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import "./globals.css";

// Two faces, both bundled at build by next/font (no runtime request to
// Google). Funnel Display carries titles and names, Funnel Sans everything
// else (docs/DESIGN.md, "Type"). The wordmark is a vector, not a font.
const funnelDisplay = Funnel_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-funnel-display",
  display: "swap",
});

const funnelSans = Funnel_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-funnel-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NowTutors",
  description: "Live tutoring marketplace: find a tutor and learn now.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${funnelDisplay.variable} ${funnelSans.variable}`}
    >
      <body>
        {/* useSearchParams needs a Suspense boundary to keep pages dynamic-safe. */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
