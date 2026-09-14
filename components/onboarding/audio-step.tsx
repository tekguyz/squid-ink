"use client";

import { HudLevelBars } from "@/components/recorder/hud-level-bars";
import { PRIMARY, StepActions, StepHeader } from "./step-parts";
import { useMicTest, type MicState } from "./use-mic-test";

/**
 * Step 1 — Allow audio capture.
 *
 * TWO ROWS, AND ONLY ONE HAS A BUTTON. The drawing shows System audio as
 * "Granted". A web page cannot hold that grant: system and tab audio arrive
 * through the share picker, which Chromium shows on every recording and never
 * remembers. So the row says when it is asked instead of pretending it was
 * answered. The microphone IS a remembered permission, and gets Allow.
 *
 * The meter is the Record HUD's own `HudLevelBars`, fed by the recorder's
 * `readLevel` through useMicTest — not a second level meter.
 *
 * Continue is never blocked. The drawing's own line: you can record without a
 * microphone, you just lose speaker labels.
 */

const ROW = "bg-raised grid grid-cols-[1fr_140px] items-center gap-[14px] px-[14px] py-[13px]";
const PILL = "py-[7px] text-center font-mono text-[9.5px] tracking-[0.06em] uppercase";

const MIC_LABEL: Record<MicState, string> = {
  unknown: "Checking",
  prompt: "Allow",
  granted: "Allowed",
  denied: "Blocked",
  unsupported: "Not available",
};

export function AudioStep({ onContinue }: { onContinue: () => void }) {
  const mic = useMicTest();
  const canAsk = mic.state === "prompt" || (mic.state === "granted" && !mic.listening);

  return (
    <>
      <StepHeader
        title="Allow audio capture"
        lede="Squid Ink records a meeting the way you hear it — the call's audio plus your microphone. The browser asks for each one."
      />

      <div className="mt-[22px] flex max-w-[680px] flex-col gap-[9px]">
        <div className={ROW}>
          <div>
            <p className="font-body text-ink text-[14px] font-medium">System audio</p>
            <p className="font-mono text-meta-2 mt-[3px] text-[9.5px] uppercase">
              Captures what the other people say
            </p>
          </div>
          <p className={`${PILL} border-rule-2 text-muted border`}>Asked each recording</p>
        </div>

        <div className={ROW}>
          <div>
            <p className="font-body text-ink text-[14px] font-medium">Microphone</p>
            <p className="font-mono text-meta-2 mt-[3px] text-[9.5px] uppercase">
              Captures you · required for speaker labels
            </p>
          </div>
          {canAsk ? (
            <button
              type="button"
              onClick={() => void mic.allow()}
              aria-label={mic.state === "granted" ? "Test microphone" : "Allow microphone"}
              className={`${PILL} bg-accent text-on-accent hover:bg-accent-pressed focus-visible:outline-accent cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2`}
            >
              {mic.state === "granted" ? "Test" : "Allow"}
            </button>
          ) : (
            <p
              role="status"
              className={`${PILL} ${mic.state === "granted" ? "bg-tint text-accent-text" : "border-rule-2 text-muted border"}`}
            >
              {MIC_LABEL[mic.state]}
            </p>
          )}
        </div>
      </div>

      <div className="mt-[20px]">
        <p className="font-mono text-meta-4 text-[8.5px] tracking-[0.14em] uppercase">
          Input test
        </p>
        <div className="mt-[9px] flex h-[24px] items-end">
          {mic.listening ? (
            <HudLevelBars level={mic.level} />
          ) : (
            <span className="font-mono text-meta text-[9px] uppercase">
              {mic.state === "denied"
                ? "Microphone blocked — allow it from the address bar to test"
                : "Allow the microphone to see a live level"}
            </span>
          )}
        </div>
        {mic.listening && (
          <p className="font-mono text-meta mt-[5px] text-[9px] uppercase">
            Say something — the bars should move
          </p>
        )}
      </div>

      <StepActions>
        <button type="button" onClick={onContinue} className={PRIMARY}>
          Continue
        </button>
        <p className="font-body text-muted text-[12.5px]">
          You can record without a microphone — you just lose speaker labels.
        </p>
      </StepActions>
    </>
  );
}
