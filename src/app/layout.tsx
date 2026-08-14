import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrayerCanvas",
  description: "Speak a prayer. We'll turn it into a beautiful shareable video.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
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
