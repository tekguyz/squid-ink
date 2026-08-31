"use client";

import { usePathname } from "next/navigation";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorder } from "@/lib/recorder/use-recorder";

/** Routes reachable without a session. Mirrors PUBLIC_PREFIXES in
 *  lib/supabase/session.ts — a HUD on the sign-in page would offer a recording
 *  that has nowhere to go. */
const HIDDEN_PREFIXES = ["/login", "/auth"];

/**
 * The client island mounted in the root layout.
 *
 * This file is the whole point of the track: because it is rendered by
 * app/layout.tsx and the store lives at module scope, the recorder survives
 * every navigation. Nothing re-creates the store per route, and there is no
 * provider a route change could remount.
 */
export function RecorderDock() {
  const pathname = usePathname();
  const controls = useRecorder();

  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;

  return <RecordHud controls={controls} />;
}
