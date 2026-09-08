import type { MetadataRoute } from "next";
import { pages } from "./content";
import { PREVIEW_DEPLOYMENT, SITE_URL } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (PREVIEW_DEPLOYMENT) return [];
  return ["", "/editor", "/guides", ...pages.map((page) => `/${page.slug}`)].map((path) => ({ url: `${SITE_URL}${path}` }));
}
