import type { Metadata } from "next";
import { Bitter, Archivo, IBM_Plex_Mono } from "next/font/google";
import { RecorderDock } from "@/components/recorder/recorder-dock";
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

export const metadata: Metadata = {
  title: "Note detail",
  description: "Review a note and its source transcript.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
        {children}
        {/* Mounted here, not per route: the HUD has to survive navigation, and
            the recorder store lives at module scope so it never resets. This
            layout stays a server component — the dock is an isolated client
            island, not a reason to convert the shell. */}
        <RecorderDock />
      </body>
    </html>
  );
}
