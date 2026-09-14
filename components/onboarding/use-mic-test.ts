"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readLevel } from "@/lib/recorder/browser-deps";

/**
 * The microphone half of onboarding step 1: ask for the mic, then show a live
 * level so the user can see it works.
 *
 * THE METERING IS THE RECORDER'S. `readLevel` is the same peak read the Record
 * HUD's meter is fed from, and the analyser is configured as
 * lib/recorder/capture.ts configures it (fftSize 1024, mic branch only) with
 * the same `{ echoCancellation: true }` constraint. What is NOT reused is
 * `startCapture` itself: it opens the system-audio share picker first, and a
 * screen-share dialog is the wrong thing to throw at someone testing a mic.
 *
 * Nothing is recorded. The stream is stopped on unmount.
 */

export type MicState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

const TICK_MS = 200;

export interface MicTest {
  state: MicState;
  /** 0..1, live while the test runs. */
  level: number;
  /** True once a stream is open and the meter is moving. */
  listening: boolean;
  allow(): Promise<void>;
}

export function useMicTest(): MicTest {
  const [state, setState] = useState<MicState>("unknown");
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // The permission as the browser already holds it, so a returning browser
  // that granted the mic before does not see "Allow" again. Firefox and older
  // Safari do not know the "microphone" name; that is "prompt", not an error.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    // No Permissions API at all (older Safari): nothing to read, so offer Allow.
    if (!navigator.permissions) {
      setState("prompt");
      return;
    }
    let cancelled = false;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (!cancelled) setState(status.state);
      })
      .catch(() => {
        if (!cancelled) setState("prompt");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRef.current?.();
    };
  }, []);

  const allow = useCallback(async () => {
    if (stopRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true },
      });
    } catch {
      if (mounted.current) setState("denied");
      return;
    }
    // The step can unmount while the browser prompt is open (Continue stays
    // clickable). Cleanup has already run by then, so close the stream here or
    // the mic stays live with nobody holding it.
    if (!mounted.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);

    const id = setInterval(() => setLevel(readLevel(analyser)), TICK_MS);
    stopRef.current = () => {
      clearInterval(id);
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    };
    setState("granted");
    setListening(true);
  }, []);

  return { state, level, listening, allow };
}
