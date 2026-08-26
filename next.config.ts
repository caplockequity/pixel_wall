import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog uses trailing-slash ingestion endpoints such as /e/ and /s/.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
