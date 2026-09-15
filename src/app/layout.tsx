import type { Metadata } from "next";
import { DM_Sans, Funnel_Display, Funnel_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Three faces, all bundled at build by next/font (no runtime request to
// Google). Funnel Display carries titles and names, Funnel Sans everything
// else, DM Sans only the wordmark (docs/DESIGN.md, "Type").
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

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-dm-sans",
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
      className={`${funnelDisplay.variable} ${funnelSans.variable} ${dmSans.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
