"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { useRecorder } from "@/lib/recorder/use-recorder";

/** Routes reachable without a session. Mirrors PUBLIC_PREFIXES in
 *  lib/supabase/session.ts — a HUD on the sign-in page would offer a recording
 *  that has nowhere to go.
 *
 *  Plus /onboarding, added 2026-09-14. That route is a first-run gate that
 *  runs its own microphone test, and a Record pill beside it would open a
 *  second capture over the one being tested, before the account has reached
 *  any screen a note could be opened from. */
const HIDDEN_PREFIXES = ["/login", "/auth", "/onboarding"];

/**
 * The client island mounted in the root layout.
 *
 * This file is the whole point of the track: because it is rendered by
 * app/layout.tsx and the store lives at module scope, the recorder survives
 * every navigation. Nothing re-creates the store per route, and there is no
 * provider a route change could remount.
 */
export function RecorderDock({ demo = false }: { demo?: boolean }) {
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
    // A demo visitor's Record controls are all turned off; this is the second
    // half of that, so no request can start a capture there.
    if (demo) return;
    void controls.start();
  }, [startRequests, controls, demo]);

  // Development only (#24): scripts/verify-layout.mjs sets the HUD's phases
  // through this to measure each pill. `next build` replaces NODE_ENV, so the
  // branch is dead code in production.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as { __recorderStore?: typeof useRecorderStore }).__recorderStore =
      useRecorderStore;
  }, []);

  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;

  return <RecordHud controls={controls} demo={demo} />;
}
