import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ErrorBoundary from "./components/ErrorBoundary";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Wired into globals.css's @theme as --font-mono, but never actually loaded
// before this pass — font-mono silently fell back to a system monospace
// font on every page. Now used for ₹ costs, durations, and other data-shaped
// text so numbers read as verified rather than generated.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Domain isn't purchased yet (see CLAUDE.md) — resolve to whatever Vercel
// deployment is live, falling back to localhost in dev. Pointing a real
// domain later is then a one env var change, not a code change.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Naviro — Your AI travel guide",
    template: "%s · Naviro",
  },
  description:
    "AI-powered, hyper-local day-by-day itineraries for anywhere in India. Every place verified real, open, and roughly the cost quoted — planned in one prompt.",
  keywords: [
    "AI travel planner India",
    "itinerary generator India",
    "local travel guide India",
    "trip planning app",
  ],
  openGraph: {
    title: "Naviro — Your AI travel guide",
    description:
      "One prompt. A real, verified, day-by-day itinerary for anywhere in India.",
    siteName: "Naviro",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Naviro — Your AI travel guide",
    description:
      "One prompt. A real, verified, day-by-day itinerary for anywhere in India.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1117",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="grain-overlay" aria-hidden="true" />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
