"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadNoteAudio } from "@/lib/notes/audio-playback";

/**
 * The only way to hear a recording in the app. Until this shipped, the audio
 * could be captured, uploaded and transcribed with nobody able to play it back
 * — `docs/qa/recorder-manual-test-protocol.md` pulled objects with the secret
 * key and ffprobe instead.
 *
 * Deliberately NOT a native `<audio controls>`: the browser's own chrome is
 * untokenised and would clash with both themes. The element is present but
 * silent-looking, and every visible control here is ours.
 *
 * The waveform/timeline scrubber is NOT this component. ROADMAP §8 puts it in
 * the Advanced phase, behind speaker tags shipping first. This is play, pause,
 * a clock and a seek bar.
 */

/** ZERO RADIUS. DESIGN.md's hardest rule: "nothing is rounded ... circles only
 *  for people." A pill transport bar with a round thumb is the default shape
 *  for this control everywhere else, and it is exactly wrong here. Every edge
 *  below is square, and the glyph is the same 9px filled square the recorder
 *  HUD uses for its record marker.
 *
 *  Spacing is the odd-number ladder (5 / 7 / 9 / 11 / 13 / 26), and 26px is the
 *  note column's gutter, so the bar lines up with the meta line above it. */
const TRANSPORT = "flex items-center gap-[11px] px-[26px] pt-[3px] pb-[15px]";

/** The recorder HUD's action-button voice, reused rather than reinvented:
 *  9px mono, uppercase, 0.06em, square border. */
const BUTTON =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer " +
  "flex items-center gap-[7px] border border-rule-2 bg-canvas text-notice " +
  "px-[9px] py-[5px] transition-colors " +
  "hover:border-tint-hover hover:bg-tint hover:text-accent-text " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** A range input is THREE separate, non-inheriting pseudo-element rule sets —
 *  WebKit's thumb, Firefox's thumb, Firefox's track — so each is written out.
 *  Leaving any of them at the browser default would drop untokenised blue
 *  chrome into a warm-neutral sheet, in both themes, the same way an unstyled
 *  <audio controls> would. Every value is a token; the guard in
 *  project-conventions.test.ts fails the build on a literal.
 *
 *  The thumb is a 9px square in the accent, matching the glyph. */
const SEEK =
  "h-[3px] flex-1 cursor-pointer appearance-none bg-rule-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[9px] " +
  "[&::-webkit-slider-thumb]:w-[9px] [&::-webkit-slider-thumb]:border-0 " +
  "[&::-webkit-slider-thumb]:bg-accent " +
  "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-[9px] " +
  "[&::-moz-range-thumb]:w-[9px] [&::-moz-range-thumb]:border-0 " +
  "[&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:bg-accent " +
  "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-rule-2";

/** The 9–10px mono slug the rest of the metadata ladder uses. */
const CLOCK = "font-mono text-[10px] tabular-nums tracking-[0.04em] text-meta";

const NOTICE =
  "px-[26px] pt-[3px] pb-[15px] font-mono text-[9px] tracking-[0.14em] uppercase text-meta";

/** Matches the note meta line's clock format, and carries tabular-nums where
 *  it is rendered — DESIGN.md's Tabular Rule. */
function mmss(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

type Status = "loading" | "unavailable" | "ready";

export function AudioPlayer({ storagePath }: { storagePath: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  // The object URL's whole lifetime is this effect. It is created only after a
  // successful download, and revoked both on unmount and when storagePath
  // changes — so navigating between notes leaks nothing. `cancelled` is what
  // stops a slow response from a previous note landing on the new one.
  useEffect(() => {
    if (!storagePath) return;

    let cancelled = false;
    let loaded: { revoke(): void } | null = null;

    setStatus("loading");
    setUrl(null);
    setPlaying(false);
    setElapsed(0);
    setDuration(0);

    void loadNoteAudio(storagePath)
      .then((object) => {
        if (cancelled) {
          object?.revoke();
          return;
        }
        if (!object) {
          setStatus("unavailable");
          return;
        }
        loaded = object;
        setUrl(object.url);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        // A missing object is a state; anything else is worth a log line, but
        // it reads the same to the reader: there is nothing to play.
        console.error("Could not load the recording:", error);
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
      loaded?.revoke();
    };
  }, [storagePath]);

  const toggle = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      setPlaying(false);
    } else {
      void element.play();
      setPlaying(true);
    }
  }, [playing]);

  const seek = useCallback((seconds: number) => {
    const element = audio.current;
    if (element) element.currentTime = seconds;
    setElapsed(seconds);
  }, []);

  if (!storagePath) return null;
  if (status !== "ready") {
    return <p className={NOTICE}>{status === "loading" ? "Loading audio" : "Audio unavailable"}</p>;
  }

  return (
    <div className={TRANSPORT}>
      <audio
        ref={audio}
        src={url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />

      {/* A real <button> with a visible label, matching the citation-chip
          precedent. The accessible name contains the visible word, so voice
          control can address it; aria-pressed carries the playing state. */}
      <button
        type="button"
        aria-label={playing ? "Pause recording" : "Play recording"}
        aria-pressed={playing}
        className={BUTTON}
        onClick={toggle}
      >
        <span
          aria-hidden
          className={`h-[9px] w-[9px] ${playing ? "border border-current" : "bg-current"}`}
        />
        {playing ? "Pause" : "Play"}
      </button>

      <input
        type="range"
        aria-label="Seek recording"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(elapsed, duration || 0)}
        className={SEEK}
        onChange={(event) => seek(Number(event.currentTarget.value))}
      />

      <span className={CLOCK}>
        {mmss(elapsed)} / {mmss(duration)}
      </span>
    </div>
  );
}
