"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { applySavedPanes, setPane, showPaneForNow, usePane } from "./pane-state";

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

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
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
  const toggleLens = useCallback(() => {
    if (phone) return;
    const next = lens === "shown" ? "hidden" : "shown";
    const hadFocus = document.activeElement;
    flushSync(() => setPane("lens", next));
    if (hadFocus === lensHide.current || hadFocus === lensShow.current)
      (next === "hidden" ? lensShow : lensHide).current?.focus();
  }, [lens, phone]);

  const toggleTranscript = useCallback(() => {
    if (narrow) {
      if (overlayOpen) closeOverlay();
      else openOverlay();
      return;
    }
    const next = transcript === "shown" ? "hidden" : "shown";
    const hadFocus = document.activeElement;
    flushSync(() => setPane("transcript", next));
    if (hadFocus === transcriptHide.current || hadFocus === transcriptShow.current)
      (next === "hidden" ? transcriptShow : transcriptHide).current?.focus();
  }, [narrow, overlayOpen, transcript, openOverlay, closeOverlay]);

  /** A citation always shows its source. This opens the pane for now and
   *  never writes the saved choice. */
  const revealTranscript = useCallback(() => {
    if (narrow) {
      if (!overlayOpen) openOverlay();
    } else if (transcript === "hidden") {
      flushSync(() => showPaneForNow("transcript"));
    }
  }, [narrow, overlayOpen, transcript, openOverlay]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && overlay) {
        closeOverlay();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.isComposing || isTyping(event.target)) return;
      if (event.key === "[") toggleLens();
      else if (event.key === "]") toggleTranscript();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay, toggleLens, toggleTranscript]);

  return {
    lensShown,
    transcriptShown,
    overlay,
    toggleLens,
    toggleTranscript,
    revealTranscript,
    refs: { lensHide, lensShow, transcriptHide, transcriptShow },
  };
}
