import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

// Only wrap with Sentry when a DSN is configured. With a blank SENTRY_DSN the
// plain config is exported, so local dev and preview builds are never affected
// by Sentry (no source-map upload attempts, no auth-token warnings).
const config: NextConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true })
  : nextConfig;

export default config;
