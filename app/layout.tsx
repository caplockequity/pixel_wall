import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PREVIEW_DEPLOYMENT, SITE_DESCRIPTION, SITE_URL } from "./site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = { colorScheme: "light", themeColor: "#171628" };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "PixelWall",
  title: { default: "PixelWall — Online Pixel Art Editor", template: "%s | PixelWall" },
  description: SITE_DESCRIPTION,
  manifest: "/pixelwall.webmanifest",
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
  robots: PREVIEW_DEPLOYMENT
    ? { index: false, follow: false }
    : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  icons: {
    icon: [{ url: "/pixelwall-mark.svg", type: "image/svg+xml" }, { url: "/pixelwall-mark-32.png", type: "image/png", sizes: "32x32" }],
    shortcut: "/pixelwall-mark.svg",
    apple: [{ url: "/pixelwall-apple-touch.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
