import type { Metadata } from "next";

export const SITE_URL = "https://www.pixelwall.dev";
export const SITE_NAME = "PixelWall";
export const PREVIEW_DEPLOYMENT = process.env.VERCEL_ENV === "preview";
export const SITE_DESCRIPTION = "Create pixel art in your browser. Trace references, draw with layers, animate sprites, and build tilemaps. Free editing and PNG exports; optional one-time Pro exports.";

export function pageMetadata(title: string, description: string, path = "/"): Metadata {
  const url = `${SITE_URL}${path === "/" ? "" : path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website", siteName: SITE_NAME, title: `${title} | PixelWall`, description, url,
      images: [{ url: `${SITE_URL}/og.png`, width: 1731, height: 909, alt: "PixelWall pixel art studio" }],
    },
    twitter: { card: "summary_large_image", title: `${title} | PixelWall`, description, images: [`${SITE_URL}/og.png`] },
  };
}
