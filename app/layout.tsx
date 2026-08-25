import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#171628",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "pixelwall-maker.ben-zavadil.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "PixelWall — Pixel Art Maker";
  const description = "Trace and draw layered pixel art, build named game animations, preview seamless tiles, and export engine-ready sprite packages or portable projects.";
  const socialImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    applicationName: "PixelWall",
    title,
    description,
    manifest: "/site.webmanifest",
    alternates: {
      canonical: origin,
    },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      ],
      shortcut: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      url: origin,
      title,
      description,
      images: [{
        url: socialImage,
        width: 1731,
        height: 909,
        type: "image/png",
        alt: "PixelWall wordmark beneath a framed pixel-art sunset illuminated by a projector",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{
        url: socialImage,
        alt: "PixelWall wordmark beneath a framed pixel-art sunset illuminated by a projector",
      }],
    },
    other: {
      "msapplication-TileColor": "#FFE66D",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
