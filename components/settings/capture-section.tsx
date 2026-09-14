"use client";

import { useState } from "react";
import { saveCaptureSettings } from "@/app/notes/actions/settings";
import type { UserSettings } from "@/lib/settings/settings-types";
import { useDirtySection } from "./dirty-registry";
import { GroupLabel, SectionFrame } from "./section-frame";

/**
 * Capture & audio, App Surfaces 06's "Capture defaults".
 *
 * The drawing has three rows here. ONE ships.
 *
 * - "Speaker diarization" is ABSENT, not disabled: docs/DECISIONS.md § Speaker
 *   diarization locks it as automatic past ~28 minutes with "no manual toggle
 *   needed". A greyed-out switch would suggest it is coming.
 * - "Keep local audio after structuring · deletes after 30 days" is absent:
 *   no retention or deletion job exists, and a switch would promise one.
 * - "Require a citation for every claim" ships as a real, persisted toggle.
 *   The behaviour is real and always on; the PREFERENCE is not yet read by the
 *   chat or RAG path. The meta line says so rather than implying that turning
 *   it off changes anything. docs/KNOWN_GAPS.md records the gap.
 */
export function CaptureSection({ initial }: { initial: UserSettings }) {
  const [saved, setSaved] = useState(initial.requireCitations);
  const [requireCitations, setRequireCitations] = useState(saved);

  useDirtySection(
    "capture",
    "Capture & audio",
    requireCitations === saved ? 0 : 1,
    async () => {
      const outcome = await saveCaptureSettings({ requireCitations });
      if (outcome !== "written") throw new Error(`Capture settings not saved: ${outcome}`);
      setSaved(requireCitations);
    },
    () => setRequireCitations(saved),
  );

  return (
    <SectionFrame
      id="capture"
      title="Capture & audio"
      lede="Saved to your account when you press Update."
    >
      <GroupLabel>Capture defaults</GroupLabel>
      <div className="mt-[10px]">
        <div className="border-rule-3 grid grid-cols-[minmax(0,1fr)_88px] items-center gap-[14px] border-b py-[11px]">
          <div>
            <p id="require-citations-label" className="font-body text-ink text-[13.5px]">
              Require a citation for every claim
            </p>
            <p className="font-mono text-meta-2 mt-[3px] text-[9.5px] uppercase">
              Saved · not yet read by chat · ungrounded claims are always dropped today
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={requireCitations}
            aria-labelledby="require-citations-label"
            onClick={() => setRequireCitations((on) => !on)}
            className={`border-control-edge focus-visible:outline-accent relative h-[19px] w-[34px] cursor-pointer justify-self-end border focus-visible:outline-2 focus-visible:outline-offset-2 ${
              requireCitations ? "bg-tint" : "bg-raised"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-[1px] h-[15px] w-[15px] ${
                requireCitations ? "bg-accent-pressed right-[1px]" : "bg-meta left-[1px]"
              }`}
            />
          </button>
        </div>
      </div>
    </SectionFrame>
  );
}
