import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog uses trailing-slash ingestion endpoints such as /e/ and /s/.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      // Stripe sessions created before the studio moved retain their old return URL.
      { source: "/", has: [{ type: "query", key: "checkout" }], destination: "/editor", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/:path*", has: [{ type: "host", value: ".*\\.vercel\\.app" }], headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      ...(process.env.VERCEL_ENV === "preview" ? [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }] : []),
    ];
  },
};

export default nextConfig;
