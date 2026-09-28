"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether each pane on a note is hidden (issue #23). Per browser, not per
 * account: one `localStorage` value per pane, mirrored onto `<html>` as a
 * `data-pane-*` attribute.
 *
 * The ATTRIBUTE is the live state. `PaneBoot` sets it from storage before
 * first paint, the shell's grid reads it through CSS, and React reads it
 * here — so the three cannot disagree, and a hidden pane never flashes open.
 * Storage is only what the next visit starts from. That split is what lets a
 * citation open a hidden transcript for this visit without touching the
 * reader's saved choice.
 *
 * Every storage call is wrapped: a private window or blocked site data makes
 * `localStorage` throw, and a pane that cannot be remembered is still a pane
 * that can be hidden.
 */

export type PaneName = "lens" | "transcript";
export type PaneState = "shown" | "hidden";

/** Both names are literals in `pane-boot.tsx` too, which cannot import. */
const ATTRIBUTE: Record<PaneName, string> = {
  lens: "data-pane-lens",
  transcript: "data-pane-transcript",
};
const STORAGE_KEY: Record<PaneName, string> = {
  lens: "pane:lens",
  transcript: "pane:transcript",
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readPane(pane: PaneName): PaneState {
  return document.documentElement.getAttribute(ATTRIBUTE[pane]) === "hidden"
    ? "hidden"
    : "shown";
}

function writeAttribute(pane: PaneName, state: PaneState) {
  const root = document.documentElement;
  if (state === "hidden") root.setAttribute(ATTRIBUTE[pane], "hidden");
  else root.removeAttribute(ATTRIBUTE[pane]);
}

/** A reader's choice: shown now, and on the next note and the next visit. */
export function setPane(pane: PaneName, state: PaneState) {
  writeAttribute(pane, state);
  try {
    localStorage.setItem(STORAGE_KEY[pane], state);
  } catch {}
  listeners.forEach((listener) => listener());
}

/** Shown for this visit only; the saved choice is not written. */
export function showPaneForNow(pane: PaneName) {
  writeAttribute(pane, "shown");
  listeners.forEach((listener) => listener());
}

/** Puts the saved choice back on `<html>`. The shell calls it on each note,
 *  so a pane a citation opened for now closes again on the next one. */
export function applySavedPanes() {
  for (const pane of ["lens", "transcript"] as const) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY[pane]);
    } catch {}
    writeAttribute(pane, saved === "hidden" ? "hidden" : "shown");
  }
  listeners.forEach((listener) => listener());
}

/** The server knows no storage, so it renders every pane shown; CSS on the
 *  boot script's attribute already draws the truth before React hydrates. */
export function usePane(pane: PaneName): PaneState {
  return useSyncExternalStore(
    subscribe,
    () => readPane(pane),
    () => "shown",
  );
}
