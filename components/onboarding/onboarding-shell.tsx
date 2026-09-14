"use client";

import { useState } from "react";
import { signOut } from "@/app/notes/actions/session";
import type { PersonaConfig } from "@/lib/notes/get-personas-screen";
import { AudioStep } from "./audio-step";
import { CalendarStep } from "./calendar-step";
import { PersonaStep } from "./persona-step";

/**
 * Onboarding, App Surfaces 05: a left rail listing the steps, the current
 * step on the right.
 *
 * Three steps. The drawing's first, "Name this workspace", is cut — see
 * app/onboarding/page.tsx. Step state is local `useState`: nothing outside
 * this screen reads it, and a reload restarting at step 1 costs nothing,
 * because the only write before the last step (the default lens) is already
 * saved and shows as selected when step 2 comes round again.
 *
 * No AppNav. Every link in it would bounce straight back here through the
 * proxy's first-run gate, so it would be four controls that do nothing.
 * Sign-out stays, because an account must always be able to leave.
 *
 * Held at MIN_SURFACE_WIDTH, the same interim treatment app/page.tsx
 * documents; nothing below 1280px is designed.
 */
const MIN_SURFACE_WIDTH = 1280;

const STEPS = [
  { title: "Allow audio capture", sub: "System + mic" },
  { title: "Pick a default persona", sub: "Changeable any time" },
  { title: "Connect calendar", sub: "Optional · skippable" },
] as const;

export function OnboardingShell({
  personas,
  defaultPersonaId,
}: {
  personas: PersonaConfig[];
  defaultPersonaId: string;
}) {
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div className="scroll-thin h-dvh overflow-x-auto overflow-y-hidden">
      <div
        style={{ minWidth: MIN_SURFACE_WIDTH }}
        className="bg-paper text-ink grid h-full grid-cols-[264px_minmax(0,1fr)]"
      >
        <aside className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r px-[22px] py-[26px]">
          <p className="font-header text-ink flex items-center gap-[8px] text-[14px] font-bold">
            <span aria-hidden="true" className="bg-accent h-[16px] w-[16px]" />
            Squid Ink
          </p>

          <ol aria-label="Onboarding steps" className="mt-[26px] flex flex-col gap-[2px]">
            {STEPS.map((item, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li
                  key={item.title}
                  aria-current={current ? "step" : undefined}
                  className={[
                    "grid grid-cols-[20px_1fr] items-baseline gap-[10px] py-[9px]",
                    current
                      ? "border-accent bg-raised -ml-[12px] border-l-2 pl-[10px]"
                      : "",
                  ].join(" ")}
                >
                  <span
                    className={`font-mono text-[10px] ${done || current ? "text-accent-text" : "text-meta"}`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span>
                    <span
                      className={`font-body block text-[13.5px] ${current ? "text-ink font-medium" : "text-muted"}`}
                    >
                      {item.title}
                    </span>
                    <span className="font-mono text-meta block text-[9px] uppercase">
                      {item.sub}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-auto flex flex-col gap-[14px]">
            <p className="font-mono text-meta text-[9px] leading-[1.8] uppercase">
              No bot ever joins your calls.
              <br />
              Nothing uploads during capture.
            </p>
            <form action={signOut}>
              <button
                type="submit"
                className="font-mono text-muted hover:text-ink focus-visible:outline-accent cursor-pointer text-[9.5px] tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Log me out
              </button>
            </form>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden px-[32px] py-[30px]">
          <h1 className="sr-only">Welcome to Squid Ink</h1>
          <p className="font-mono text-meta text-[9px] tracking-[0.14em] uppercase">
            Step {step + 1} of {STEPS.length}
          </p>
          {step === 0 && <AudioStep onContinue={next} />}
          {step === 1 && (
            <PersonaStep
              personas={personas}
              defaultPersonaId={defaultPersonaId}
              onContinue={next}
            />
          )}
          {step === 2 && <CalendarStep />}
        </main>
      </div>
    </div>
  );
}
