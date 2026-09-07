"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
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

  // The one place a Record control outside this dock is served. The dashboard
  // header has its own Record button; it increments `startRequests` rather than
  // calling useRecorder itself, because a second hook instance would be a
  // second MediaRecorder that the HUD's Pause and Stop could never reach.
  const startRequests = useRecorderStore((s) => s.startRequests);
  const served = useRef(startRequests);
  useEffect(() => {
    if (startRequests === served.current) return;
    served.current = startRequests;
    void controls.start();
  }, [startRequests, controls]);

  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;

  return <RecordHud controls={controls} />;
}
