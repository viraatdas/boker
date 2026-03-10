import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "boker",
  description: "Play-money No-Limit Hold'em poker with friends and AI.",
  metadataBase: new URL("https://boker.viraat.dev"),
  openGraph: {
    title: "boker",
    description: "Play-money No-Limit Hold'em poker with friends and AI.",
    siteName: "boker",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "boker",
    description: "Play-money No-Limit Hold'em poker with friends and AI.",
  },
  other: {
    "theme-color": "#1a1a2e",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>{children}</body>
    </html>
  );
}
