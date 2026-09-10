import type { MetadataRoute } from "next";
import { PREVIEW_DEPLOYMENT, SITE_URL } from "./site";

export default function robots(): MetadataRoute.Robots {
  return PREVIEW_DEPLOYMENT
    ? { rules: [{ userAgent: "*", disallow: "/" }] }
    : { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/beam/", "/*?*checkout=", "/*?*session_id="] }], sitemap: `${SITE_URL}/sitemap.xml` };
}
