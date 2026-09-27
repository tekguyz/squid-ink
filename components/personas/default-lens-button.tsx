"use client";

import { useOptimistic } from "react";
import { setDefaultPersona } from "@/app/notes/actions/configure-persona";
import { usePersonaWrite } from "./use-persona-write";
import { useDemo } from "@/components/demo/demo-mode";
import { PERSONAS_DEMO_OFF } from "@/lib/auth/demo-visitor";

/**
 * "Set as default" — which lens a NEW note is seeded with.
 *
 * IT WRITES A PREFERENCE THAT ALREADY EXISTED. `last_persona_id` has sat in
 * Auth user metadata since 2026-09-02 and `seedNotePersona` in
 * app/notes/actions/persona.ts has read it on every note created since. The
 * only thing missing was a way to set it other than picking a lens on a note.
 * So this is not a new setting and needs no column, no table and no partial
 * unique index — see docs/DECISIONS.md § Personas, amended 2026-09-09.
 *
 * NOT DEFAULT_PERSONA_ID. That slug stays the fixed fallback — the lens an
 * account with no preference gets, and the slug lib/notegen/resolve-persona.ts
 * matches at step 2. This button chooses what sits in front of that fallback,
 * and cannot move it.
 *
 * THE CURRENT DEFAULT IS DISABLED, not hidden. A control that would write the
 * value already stored has nothing to do, and saying "Default" in its place
 * answers the question the reader actually has: which one is it.
 */

const LABEL =
  "font-mono text-[10px] tracking-[0.06em] uppercase border px-[11px] py-[7px] flex items-center gap-[8px]";

/** Why the enabled control exists at all, said where a reader will find it.
 *  On the wrapper rather than the button: a disabled element receives no
 *  pointer events, so a title on the control itself never appears once this
 *  lens becomes the default. */
const EXPLAINS = "New notes open on this lens. Notes already written keep theirs.";

export function DefaultLensButton({
  slug,
  defaultPersonaId,
}: {
  slug: string;
  defaultPersonaId: string;
}) {
  const { pending, message, run } = usePersonaWrite();
  const [shown, setShown] = useOptimistic(defaultPersonaId);
  const isDefault = shown === slug;
  // Issue #19: a demo visitor cannot move the default. "Default" still reads.
  const off = useDemo() && !isDefault;

  return (
    <div className="flex items-center gap-[8px]">
      {message !== null && (
        <span role="alert" className="font-mono text-notice text-[9.5px]">
          {message}
        </span>
      )}

      <span title={EXPLAINS}>
        <button
          type="button"
          disabled={isDefault || pending || off}
          aria-pressed={isDefault}
          aria-describedby={off ? PERSONAS_DEMO_OFF : undefined}
          onClick={() =>
            run(async () => {
              setShown(slug);
              return setDefaultPersona(slug);
            })
          }
          className={[
            LABEL,
            "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
            isDefault
              ? "border-control-edge bg-tint text-accent-text cursor-default"
              : off
                ? "border-rule-2 text-ink-disabled cursor-not-allowed"
                : pending
                ? "border-rule-2 text-ink-disabled cursor-progress"
                : "border-control-edge text-ink-2 hover:bg-raised cursor-pointer",
          ].join(" ")}
        >
          {isDefault ? "Default" : "Set as default"}
        </button>
      </span>
    </div>
  );
}
