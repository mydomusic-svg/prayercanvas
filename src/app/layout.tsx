import type { Metadata } from "next";
import localFont from "next/font/local";
import SiteHeader from "./site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrayerCanvas",
  description: "Speak a prayer. We'll turn it into a beautiful shareable video.",
};

// Preview fonts for the create-page text-style picker (see
// src/app/create/page.tsx) — the exact same font files bundled into
// worker/fonts/ for rendering, self-hosted via next/font/local (rather than
// next/font/google) so the preview doesn't depend on reaching Google Fonts
// at build time and matches the real render output pixel-for-pixel.
const greatVibes = localFont({
  src: "./fonts/GreatVibes-Regular.woff2",
  weight: "400",
  variable: "--font-calligraphy",
});
const montserrat = localFont({
  src: "./fonts/Montserrat-ExtraBold.woff2",
  weight: "800",
  variable: "--font-modern",
});
const caveat = localFont({
  src: "./fonts/Caveat-Bold.woff2",
  weight: "700",
  variable: "--font-handwritten",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${greatVibes.variable} ${montserrat.variable} ${caveat.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="py-6 text-center text-xs text-neutral-400">
          <a href="/credits" className="underline">
            Video &amp; music credits
          </a>
        </footer>
      </body>
    </html>
  );
}
