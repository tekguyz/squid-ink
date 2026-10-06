"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import {
  applySavedPanes,
  setPane,
  showPaneForNow,
  usePane,
  type PaneName,
} from "./pane-state";

/**
 * Everything the note shell needs to hide, show and open its two panes
 * (issue #23), in one place so the shell stays a layout.
 *
 * Three widths, matching the `max-lg:` / `max-md:` classes that draw them:
 * - 1024px and up: each pane hides to a strip, and the choice is saved.
 * - below 1024px: the transcript is an overlay, closed on every load. Open or
 *   closed there is never saved, so a narrow window cannot rewrite the
 *   wide-screen choice.
 * - below 768px: the lens rail is a row of tabs and does not hide.
 */

/** Tailwind v4's own `max-lg` and `max-md` conditions. */
const NARROW = "(width < 64rem)";
const PHONE = "(width < 48rem)";

export const LENS_PANE_ID = "lens-pane";
export const TRANSCRIPT_PANE_ID = "transcript-pane";

function useMedia(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}

/** A key typed into a field is text, never a shortcut. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/** What the pane's two buttons share: spread onto `PaneHideButton` and
 *  `PaneStrip`, with each one's own ref. */
export interface PaneControls {
  label: string;
  /** The key that does the same, shown in the tooltip and announced. */
  shortcut: "[" | "]";
  controls: string;
  expanded: boolean;
  onToggle: () => void;
  hideRef: RefObject<HTMLButtonElement | null>;
  showRef: RefObject<HTMLButtonElement | null>;
}

export function useNotePanes(noteId: string) {
  const lens = usePane("lens");
  const transcript = usePane("transcript");
  const narrow = useMedia(NARROW);
  const phone = useMedia(PHONE);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const lensHide = useRef<HTMLButtonElement>(null);
  const lensShow = useRef<HTMLButtonElement>(null);
  const transcriptHide = useRef<HTMLButtonElement>(null);
  const transcriptShow = useRef<HTMLButtonElement>(null);
  /** Whatever opened the overlay — the strip, a citation — gets focus back. */
  const opener = useRef<HTMLElement | null>(null);

  // Each note opens the way the reader set it, even after a citation opened
  // the transcript for now on the note before.
  useLayoutEffect(applySavedPanes, [noteId]);

  const overlay = narrow && overlayOpen;
  const lensShown = phone || lens === "shown";
  const transcriptShown = narrow ? overlay : transcript === "shown";

  const openOverlay = useCallback(() => {
    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    flushSync(() => setOverlayOpen(true));
    transcriptHide.current?.focus();
  }, []);

  const closeOverlay = useCallback(() => {
    flushSync(() => setOverlayOpen(false));
    const back = opener.current?.isConnected ? opener.current : transcriptShow.current;
    back?.focus();
  }, []);

  /** Saves the choice, then moves focus to the control that took the place
   *  of the one pressed — the pressed one has just been hidden. */
  const togglePane = useCallback(
    (
      pane: PaneName,
      shown: boolean,
      hide: RefObject<HTMLButtonElement | null>,
      show: RefObject<HTMLButtonElement | null>,
    ) => {
      const hadFocus = document.activeElement;
      flushSync(() => setPane(pane, shown ? "hidden" : "shown"));
      if (hadFocus === hide.current || hadFocus === show.current)
        (shown ? show : hide).current?.focus();
    },
    [],
  );

  const toggleLens = useCallback(() => {
    if (!phone) togglePane("lens", lens === "shown", lensHide, lensShow);
  }, [lens, phone, togglePane]);

  const toggleTranscript = useCallback(() => {
    if (!narrow)
      togglePane("transcript", transcript === "shown", transcriptHide, transcriptShow);
    else if (overlayOpen) closeOverlay();
    else openOverlay();
  }, [narrow, overlayOpen, transcript, togglePane, openOverlay, closeOverlay]);

  /** A citation always shows its source. This opens the pane for now and
   *  never writes the saved choice. */
  const revealTranscript = useCallback(() => {
    if (narrow) {
      if (!overlayOpen) openOverlay();
    } else if (transcript === "hidden") {
      flushSync(() => showPaneForNow("transcript"));
    }
  }, [narrow, overlayOpen, transcript, openOverlay]);

  // The listener reads the latest handlers through a ref, so it is added
  // once rather than on every toggle.
  const keys = useRef({ overlay, closeOverlay, toggleLens, toggleTranscript });
  useLayoutEffect(() => {
    keys.current = { overlay, closeOverlay, toggleLens, toggleTranscript };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k = keys.current;
      if (event.key === "Escape" && k.overlay) {
        k.closeOverlay();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.isComposing || isTyping(event.target)) return;
      if (event.key === "[") k.toggleLens();
      else if (event.key === "]") k.toggleTranscript();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // While the overlay is open the note behind it is inert (the shell sets
  // that), so a press anywhere outside the overlay is a press on nothing:
  // it closes the overlay, as Escape does. The strip's own button is the
  // exception: it closes the overlay by its click, and closing on the press
  // as well made that click open it again.
  useEffect(() => {
    if (!overlay) return;
    const onPointerDown = (event: PointerEvent) => {
      const pane = document.getElementById(TRANSCRIPT_PANE_ID);
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pane?.contains(target) || transcriptShow.current?.contains(target)) return;
      keys.current.closeOverlay();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [overlay]);

  const lensControls: PaneControls = {
    label: "lens rail",
    shortcut: "[",
    controls: LENS_PANE_ID,
    expanded: lensShown,
    onToggle: toggleLens,
    hideRef: lensHide,
    showRef: lensShow,
  };
  const transcriptControls: PaneControls = {
    label: "transcript",
    shortcut: "]",
    controls: TRANSCRIPT_PANE_ID,
    expanded: transcriptShown,
    onToggle: toggleTranscript,
    hideRef: transcriptHide,
    showRef: transcriptShow,
  };

  return {
    lens: lensControls,
    transcript: transcriptControls,
    overlay,
    revealTranscript,
  };
}
