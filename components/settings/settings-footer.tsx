"use client";

import { useState } from "react";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { useDirtySummary } from "./dirty-registry";

/**
 * The unsaved-changes bar, App Surfaces 06.
 *
 * It names the SECTIONS with changes, not only a count — the reason each
 * section owns its own dirty state (see dirty-registry.tsx).
 *
 * LEFT-ALIGNED, unlike the drawing, which puts Discard and Update at the far
 * right. The Record HUD owns the bottom-right corner of every screen
 * (components/recorder/hud-safe-margin.ts), and this bar sits in exactly that
 * band: buttons at the right would sit under the idle pill. The bar is
 * HUD_RESERVE tall for the same reason the Dashboard's footer is.
 *
 * It renders nothing until a section registers: a disabled bar that can never
 * enable is a dead control (issue #56).
 */

const MONO_BUTTON =
  "focus-visible:outline-accent cursor-pointer font-mono text-[10px] tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed";

export function SettingsFooter() {
  const { anyRegistered, sections, saveAll, discardAll } = useDirtySummary();
  const [phase, setPhase] = useState<"idle" | "saving" | "failed">("idle");

  const total = sections.reduce((sum, section) => sum + section.count, 0);
  const clean = total === 0;

  const summary = clean
    ? "No unsaved changes"
    : `${total} unsaved ${total === 1 ? "change" : "changes"} · ${sections
        .map((section) => section.label)
        .join(", ")}`;

  const update = async () => {
    setPhase("saving");
    try {
      await saveAll();
      setPhase("idle");
    } catch {
      setPhase("failed");
    }
  };

  if (!anyRegistered) return null;

  return (
    <footer
      style={{ height: HUD_RESERVE }}
      className="bg-dock border-rule-3 flex flex-none items-center gap-[10px] border-t px-[26px]"
    >
      <span
        role={phase === "failed" ? "alert" : "status"}
        className={`font-mono min-w-[280px] text-[9.5px] uppercase ${
          phase === "failed" ? "text-danger" : "text-meta-2"
        }`}
      >
        {phase === "failed" ? "Could not save · try again" : summary}
      </span>
      <div className="flex gap-[8px]">
        <button
          type="button"
          disabled={clean || phase === "saving"}
          onClick={() => {
            discardAll();
            setPhase("idle");
          }}
          className={`${MONO_BUTTON} border-control-edge text-notice hover:bg-raised disabled:border-rule-2 disabled:text-muted border px-[13px] py-[7px] disabled:hover:bg-transparent`}
        >
          Discard
        </button>
        <button
          type="button"
          disabled={clean || phase === "saving"}
          onClick={() => void update()}
          className={`${MONO_BUTTON} bg-accent text-on-accent hover:bg-accent-pressed disabled:bg-raised disabled:text-muted border border-transparent px-[15px] py-[7px] font-medium disabled:border-rule-2`}
        >
          {phase === "saving" ? "Saving" : "Update"}
        </button>
      </div>
    </footer>
  );
}
