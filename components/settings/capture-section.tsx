import { NotBuiltYet, SectionFrame } from "./section-frame";

/**
 * Capture & audio, App Surfaces 06's "Capture defaults".
 *
 * The drawing has three rows here. NONE ships.
 *
 * - "Speaker diarization" is ABSENT, not disabled: docs/DECISIONS.md § Speaker
 *   diarization locks it as automatic past ~28 minutes with "no manual toggle
 *   needed". A greyed-out switch would suggest it is coming.
 * - "Keep local audio after structuring · deletes after 30 days" is absent:
 *   no retention or deletion job exists, and a switch would promise one.
 * - "Require a citation for every claim" is absent: grounding is always on,
 *   so the switch could never change an answer. Removed 2026-09-26 (issue #3),
 *   with its column and its Server Action.
 *
 * The section stays as a nav destination, an honest empty state like Sharing.
 * The Update/Discard bar and components/settings/dirty-registry.tsx remain for
 * the next preference that is real.
 */
export function CaptureSection() {
  return (
    <SectionFrame
      id="capture"
      title="Capture & audio"
      lede="How a recording is captured and structured."
    >
      <NotBuiltYet>
        There are no capture preferences to set. Speakers are separated automatically on
        long recordings.
      </NotBuiltYet>
    </SectionFrame>
  );
}
