"use client";

import { useState, useTransition } from "react";
import { completeOnboarding, type OnboardingExit } from "@/app/notes/actions/onboarding";
import { PRIMARY, SECONDARY, StepActions, StepHeader, UNAVAILABLE } from "./step-parts";

/**
 * Step 3 — Connect calendar. Optional.
 *
 * NO CONNECT BUTTON OF ITS OWN, by decision (docs/DECISIONS.md § Onboarding
 * (Surface 05), 2026-09-13). "Open Connected apps" finishes onboarding and
 * lands on /settings#connected-apps, where 06's one Connect trigger lives.
 * Finishing FIRST is what makes that link work at all: the proxy's first-run
 * gate would otherwise bounce /settings straight back here.
 *
 * "Skip" is leaving the calendar unconnected — identical to never opening
 * Settings. No skip state is recorded.
 */

export function CalendarStep() {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  // Which button was pressed: that one is BUSY, the other merely unavailable.
  const [chosen, setChosen] = useState<OnboardingExit | null>(null);

  const finish = (exit: OnboardingExit) => {
    setFailed(false);
    setChosen(exit);
    startTransition(async () => {
      try {
        // Success is a server redirect the router follows; only a refusal
        // comes back as a value.
        if ((await completeOnboarding(exit)) === "invalid") setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <>
      <StepHeader
        title="Connect calendar"
        lede="Google Calendar would match a recording to the meeting it belongs to and pre-title the note. Connecting is never required to record."
      />

      <div className="bg-raised mt-[22px] max-w-[680px] px-[14px] py-[13px]">
        <p className="font-body text-ink text-[14px] font-medium">Google Calendar</p>
        <p className="font-mono text-meta-2 mt-[3px] text-[9.5px] uppercase">
          Would read events · titles, times, attendees
        </p>
        <p className="font-body text-muted mt-[8px] text-[12.5px] leading-[1.5]">
          Connecting happens in Settings → Connected apps, and only there.
        </p>
      </div>

      <StepActions>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending && chosen === "connected-apps"}
          onClick={() => finish("connected-apps")}
          className={`${PRIMARY} ${chosen === "connected-apps" ? "" : UNAVAILABLE}`}
        >
          {pending && chosen === "connected-apps" ? "Opening…" : "Open Connected apps"}
        </button>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending && chosen === "dashboard"}
          onClick={() => finish("dashboard")}
          className={`${SECONDARY} ${chosen === "dashboard" ? "" : UNAVAILABLE}`}
        >
          {pending && chosen === "dashboard" ? "Opening your notes…" : "Skip · go to my notes"}
        </button>
        {failed && (
          <p role="alert" className="font-mono text-notice text-[9.5px]">
            Onboarding did not finish. Try again.
          </p>
        )}
      </StepActions>
    </>
  );
}
