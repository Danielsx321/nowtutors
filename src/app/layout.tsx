import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import "./globals.css";

// Two faces, self-hosted from ./fonts (the latin variable woff2 files Google
// Fonts serves, OFL, see ./fonts/OFL.txt). `next/font/google` fetched them at
// build time and that fetch failed on Vercel previews, so the build no longer
// talks to Google at all. Funnel Display carries titles and names, Funnel Sans
// everything else (docs/DESIGN.md, "Type"). The wordmark is a vector, not a font.
const funnelDisplay = localFont({
  src: "./fonts/funnel-display-latin.woff2",
  weight: "600 800",
  variable: "--font-funnel-display",
  display: "swap",
});

const funnelSans = localFont({
  src: "./fonts/funnel-sans-latin.woff2",
  weight: "400 600",
  variable: "--font-funnel-sans",
  display: "swap",
});

const description = "Instant Quality Tutoring.";

// Relative image and canonical URLs resolve against `metadataBase`, which
// follows NEXT_PUBLIC_APP_URL (then the deployment's own host, then localhost).
// The share card is a versioned brand file so it can be cached for good, like
// the wordmark (next.config.ts, "/brand/:file*").
const ogImage = { url: "/brand/og.v2.png", width: 1200, height: 630, alt: "NowTutors: live tutoring marketplace" };

export const metadata: Metadata = {
  metadataBase: resolveSiteUrl(),
  title: "NowTutors",
  description,
  openGraph: {
    type: "website",
    siteName: "NowTutors",
    title: "NowTutors",
    description,
    url: "/",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "NowTutors",
    description,
    images: [ogImage.url],
  },
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
