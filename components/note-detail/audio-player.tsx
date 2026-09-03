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
 *  9px mono, uppercase, 0.06em, square border.
 *
 *  `bg-raised`, changed from `bg-canvas` on 2026-09-01. MEASURED: in dark
 *  theme `--canvas` and `--paper` resolve to the same oklch, so this button's
 *  computed background was identical to the sheet behind it and the control
 *  had no fill at all. `raised` is the token DESIGN.md § Components → Buttons
 *  already specifies for this shape. transcribe-button.tsx sits on the same
 *  meta line and carries the identical constant — they move together. */
const BUTTON =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer " +
  "flex items-center gap-[7px] border border-rule-2 bg-raised text-notice " +
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

/** Far past the end of any recording this app will ever hold — 60 minutes is
 *  the hard ceiling diarization-policy.ts enforces upstream. Seeking here is a
 *  request for the true length, not a real position. */
const PROBE_SECONDS = 1e7;

/** The element's own answer to "how long is this", or null when it does not
 *  have one yet. Infinity is the answer a headerless WebM gives, and it is a
 *  "don't know", not a length. */
function usableLength(element: HTMLAudioElement): number | null {
  if (Number.isFinite(element.duration) && element.duration > 0) return element.duration;
  if (element.seekable.length > 0) {
    const end = element.seekable.end(element.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return null;
}

/** Both glyphs are 9px square and take their colour from `currentColor`, so
 *  the button's own token drives them and no literal enters the file. Square
 *  edges, per DESIGN.md — the triangle is cut with clip-path, not a border
 *  trick, so it stays a hard-edged shape at every zoom level.
 *
 *  A filled square and a bordered square, the previous pair, read as the same
 *  9px dot on a real screen; that is why the button looked static. */
function PlayGlyph() {
  return (
    <span
      aria-hidden
      className="h-[9px] w-[9px] bg-current [clip-path:polygon(0_0,100%_50%,0_100%)]"
    />
  );
}

function PauseGlyph() {
  return (
    <span aria-hidden className="flex h-[9px] w-[9px] gap-[3px]">
      <span className="w-[3px] bg-current" />
      <span className="w-[3px] bg-current" />
    </span>
  );
}

type Status = "loading" | "unavailable" | "ready";

export function AudioPlayer({ storagePath }: { storagePath: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const probe = useRef<"idle" | "seeking" | "done">("idle");

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
    probe.current = "idle";
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

  // The button asks; the element answers. Nothing here sets `playing` — that
  // state is written only by the element's own play/pause/ended events below,
  // so a play() the browser refuses (autoplay policy, a decode failure) can
  // never leave the control claiming to be playing.
  const toggle = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  }, []);

  /**
   * MEASURED 2026-09-02 in Chromium against a real recording: a MediaRecorder
   * WebM carries no duration in its container header, so BOTH `duration` and
   * `seekable.end()` report Infinity at readyState 4 and the readout stuck at
   * "00:00 / 00:00" forever. The old `duration || 0` could not catch it —
   * Infinity is truthy.
   *
   * Three sources, cheapest first, every one native to the element:
   *   1. `duration`, when the container actually carries one (MP4 does).
   *   2. `seekable.end()`, which some builds fill in and this one does not.
   *   3. A one-shot seek far past the end. The browser answers by scanning to
   *      the true end and firing `durationchange`, at which point 1 or 2
   *      answers. The playhead goes back to 0 only WHEN that answer arrives —
   *      resetting in the same tick cancels the scan, which is the version
   *      that did not work.
   *
   * The probe runs at most once per source and only before playback, so the
   * seek bar's own behaviour is untouched.
   */
  const readDuration = useCallback((element: HTMLAudioElement) => {
    const known = usableLength(element);

    if (known === null) {
      if (probe.current !== "idle") return;
      probe.current = "seeking";
      try {
        element.currentTime = PROBE_SECONDS;
      } catch {
        // An element that refuses the seek simply keeps 00:00 — nothing to undo.
        probe.current = "done";
      }
      return;
    }

    setDuration(known);
    if (probe.current === "seeking") {
      probe.current = "done";
      element.currentTime = 0;
    }
  }, []);

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
        onLoadedMetadata={(event) => readDuration(event.currentTarget)}
        onDurationChange={(event) => readDuration(event.currentTarget)}
        onProgress={(event) => readDuration(event.currentTarget)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
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
        {playing ? <PauseGlyph /> : <PlayGlyph />}
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
