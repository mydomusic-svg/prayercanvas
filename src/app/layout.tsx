import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import SiteHeader from "./site-header";
import ServiceWorkerRegistration from "./service-worker-registration";
// Self-hosted via the @fontsource package (static files bundled at build
// time) rather than next/font/google — this sandbox's network egress
// blocks fonts.googleapis.com/fonts.gstatic.com, which next/font/google
// needs to fetch from at build time. @fontsource ships the same font as
// plain npm-installed files, so it needs no external fetch at all, the
// same reasoning the three next/font/local fonts below already follow.
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrayerMessenger",
  description:
    "Send a prayer message. Speak it, and we'll turn it into a beautiful video you can send to anyone, anytime.",
  manifest: "/manifest.webmanifest",
  // Lets the app be added to the home screen on iOS looking like a native
  // app (own icon, no Safari chrome) — Android/Chrome gets the same via
  // manifest.webmanifest above.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PrayerMessenger",
  },
  other: {
    // Next only emits the newer standardized "mobile-web-app-capable" tag
    // from appleWebApp.capable above. iOS versions before ~16.4 only
    // recognize the older Apple-prefixed one, so add it explicitly too —
    // otherwise "Add to Home Screen" opens in a plain Safari tab instead of
    // as a standalone app on those devices.
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover (not the default "auto") lets our CSS use env(safe-area-inset-*)
  // to pad around the iPhone notch/Dynamic Island and home indicator
  // instead of leaving black bars or letting content sit under them.
  viewportFit: "cover",
  themeColor: "#4f7a58",
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
      <body
        className="min-h-full flex flex-col bg-sage-50 font-sans text-sage-900"
        style={{
          // Pads the safe areas the notch/Dynamic Island and home-indicator
          // bar occupy on iPhone (and the equivalent on Android) now that
          // viewport-fit=cover lets content draw underneath them.
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <ServiceWorkerRegistration />
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer
          className="py-6 text-center text-xs text-sage-500"
          style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          <a href="/pricing" className="underline">
            Pricing
          </a>
          <span className="mx-2">&middot;</span>
          <a href="/credits" className="underline">
            Video &amp; music credits
          </a>
        </footer>
      </body>
    </html>
  );
}
