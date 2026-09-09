"use client";

import { useState, useTransition } from "react";
import type { PersonaConfigOutcome } from "@/app/notes/actions/configure-persona";
import { MAX_QUICK_ACTIONS } from "@/lib/notes/persona-config";

/**
 * Running one persona-configuration write and saying what came back.
 *
 * SHARED BECAUSE THE MESSAGE MAP IS. Three controls on this screen call the
 * same action module and can each get the same five outcomes; written out
 * three times, one of them ends up silently dropping a refusal. A refusal that
 * shows nothing is the failure mode this whole hook exists to prevent — the
 * cap especially, which the brief requires be surfaced rather than swallowed.
 *
 * A NON-"written" OUTCOME IS NOT AN ERROR, and is not thrown. It is the
 * action's answer, the same way "locked" is an answer in
 * app/notes/actions/persona.ts. Only a genuine throw — the network, or the
 * metadata write that setDefaultPersona refuses to swallow — lands in catch.
 */

/** The default wording. `invalid` is deliberately generic here because it
 *  means different things per control, so every caller that can produce one
 *  overrides it with the sentence that actually helps. */
const MESSAGES: Record<Exclude<PersonaConfigOutcome, "written">, string> = {
  invalid: "That change was refused.",
  "at-capacity": `A lens carries at most ${MAX_QUICK_ACTIONS} quick actions. Remove one first.`,
  duplicate: "That quick action is already on this lens.",
  "no-persona": "This account has no such lens to configure.",
};

export type PersonaWriteMessages = Partial<typeof MESSAGES>;

export interface PersonaWrite {
  /** True while the action and the RSC refresh behind it are in flight. */
  pending: boolean;
  /** What to show the reader, or null when the last write landed. */
  message: string | null;
  /** Run one action. The callback is invoked INSIDE the transition, so an
   *  optimistic update made at the top of it is held until the refresh
   *  arrives rather than reverting a frame later. */
  run: (op: () => Promise<PersonaConfigOutcome>) => void;
}

export function usePersonaWrite(
  overrides: PersonaWriteMessages = {},
): PersonaWrite {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run: PersonaWrite["run"] = (op) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const outcome = await op();
        setMessage(
          outcome === "written"
            ? null
            : (overrides[outcome] ?? MESSAGES[outcome]),
        );
      } catch {
        // The action threw rather than answering. Say so plainly; the reader
        // can retry, and the optimistic value has already snapped back to
        // whatever the row actually holds.
        setMessage("That change did not save. Try again.");
      }
    });
  };

  return { pending, message, run };
}
