import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Allow next/image to load avatars from the Supabase Storage public path. This
// is the Next equivalent of Bubble's image-host allowlist — the fix for the
// "LIVE tutor card photos not rendering" bug (SPEC §7.2). Host derived from
// NEXT_PUBLIC_SUPABASE_URL so it follows the project across environments.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

// Only wrap with Sentry when a DSN is configured. With a blank SENTRY_DSN the
// plain config is exported, so local dev and preview builds are never affected
// by Sentry (no source-map upload attempts, no auth-token warnings).
const config: NextConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true })
  : nextConfig;

export default config;
