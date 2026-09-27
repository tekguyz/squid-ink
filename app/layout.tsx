import type { Metadata } from "next";
import { Bitter, Archivo, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import { SignedInDock } from "@/components/recorder/signed-in-dock";
import { DemoBanner } from "@/components/demo/demo-banner";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoVisitor } from "@/lib/auth/demo-visitor";
import { DemoMode } from "@/components/demo/demo-mode";
import { ThemeBoot } from "@/components/theme-boot";
import "./globals.css";

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bitter",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const BASE_METADATA: Metadata = {
  // Share cards need absolute URLs. The production address, from
  // docs/DEPLOYMENT.md, which is the source of truth for it.
  metadataBase: new URL("https://squid-ink.vercel.app"),
  title: "Note detail",
  description: "Review a note and its source transcript.",
};

/** Search engines index the landing page and nothing behind it
 *  (DEMO-STANDARD.md rule 9, issue #19). Any page rendered for a session — a
 *  demo visitor's or a real account's — is noindex. A crawler has no session,
 *  so what it can reach is the landing page, which stays indexable. */
export async function generateMetadata(): Promise<Metadata> {
  return (await getCurrentUser())
    ? { ...BASE_METADATA, robots: { index: false, follow: false } }
    : BASE_METADATA;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The one place the "is this a demo visitor" fact reaches every client
  // island (issue #19): a page added later cannot forget it. Cached per
  // request, and generateMetadata above already awaits the same call.
  const demo = isDemoVisitor(await getCurrentUser());

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bitter.variable} ${archivo.variable} ${plexMono.variable}`}
    >
      <head>
        <ThemeBoot />
      </head>
      <body className="bg-canvas text-ink font-body antialiased">
        {/* Only for a demo visitor, and above everything: see
            components/demo/demo-banner.tsx for why it is in flow. NOT in a
            Suspense boundary, unlike the dock: streamed in late, it arrived
            after the page and pushed it down 32px. It costs no wait — the
            auth call is cached, and every page and generateMetadata above
            already await it on this request. */}
        <DemoBanner />
        <DemoMode demo={demo}>{children}</DemoMode>
        {/* Mounted here, not per route: the HUD has to survive navigation, and
            the recorder store lives at module scope so it never resets. This
            layout stays a server component — the dock is an isolated client
            island, not a reason to convert the shell. Only with a session:
            components/recorder/signed-in-dock.tsx. */}
        <Suspense fallback={null}>
          <SignedInDock />
        </Suspense>
      </body>
    </html>
  );
}
