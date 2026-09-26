"use client";

import { useState, useTransition } from "react";
import { setDefaultPersona } from "@/app/notes/actions/configure-persona";
import type { PersonaConfig } from "@/lib/notes/get-personas-screen";
import { PRIMARY, StepActions, StepHeader } from "./step-parts";

/**
 * Step 2 — Pick a default persona.
 *
 * WRITES THROUGH `setDefaultPersona`, the same action /personas' "Set as
 * default" calls. No second write path, no new column: the preference is
 * `last_persona_id` in Auth user metadata, and a new note is seeded from it.
 *
 * Saved on Continue, not on every click, so browsing the four lenses is free.
 * Continue with the preselected lens unchanged still writes it — the account
 * then holds an explicit choice rather than an implied fallback, which is
 * what "you picked one" should mean.
 */

export function PersonaStep({
  personas,
  defaultPersonaId,
  onContinue,
}: {
  personas: PersonaConfig[];
  defaultPersonaId: string;
  onContinue: () => void;
}) {
  const [selected, setSelected] = useState(defaultPersonaId);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const outcome = await setDefaultPersona(selected);
        // "no-persona" on the already-default lens is an account with zero
        // persona rows (pre-trigger, not backfilled), shown the one fallback
        // lens. There is no row to save, and the fallback is already what new
        // notes get — blocking here would lock the account out of the app.
        if (
          outcome === "written" ||
          (outcome === "no-persona" && selected === defaultPersonaId)
        ) {
          onContinue();
        }
        else setMessage("That lens could not be set. Pick another or try again.");
      } catch {
        setMessage("That choice did not save. Try again.");
      }
    });
  };

  return (
    <>
      <StepHeader
        title="Pick a default persona"
        lede="A persona is the lens a note is written through. New notes open on this one; you can change it on any note, or on the Personas screen."
      />

      <fieldset className="mt-[22px] grid max-w-[680px] grid-cols-2 gap-[9px]">
        <legend className="sr-only">Default persona</legend>
        {personas.map((persona) => {
          const checked = persona.id === selected;
          return (
            <label
              key={persona.id}
              className={[
                "has-focus-visible:outline-accent cursor-pointer border px-[14px] py-[13px] has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                checked ? "border-accent bg-tint" : "border-control-edge hover:bg-raised",
              ].join(" ")}
            >
              <input
                type="radio"
                name="default-persona"
                value={persona.id}
                checked={checked}
                onChange={() => setSelected(persona.id)}
                className="sr-only"
              />
              <span className="font-header text-ink block text-[15px] font-semibold">
                {persona.name}
              </span>
              <span className="font-mono text-meta mt-[3px] block text-[9px] uppercase">
                {persona.sub}
              </span>
            </label>
          );
        })}
      </fieldset>

      <StepActions>
        <button type="button" onClick={save} disabled={pending} aria-busy={pending} className={PRIMARY}>
          {pending ? "Saving…" : "Continue"}
        </button>
        {message !== null ? (
          <p role="alert" className="font-mono text-notice text-[9.5px]">
            {message}
          </p>
        ) : (
          <p className="font-body text-muted text-[12.5px]">Changeable any time.</p>
        )}
      </StepActions>
    </>
  );
}
