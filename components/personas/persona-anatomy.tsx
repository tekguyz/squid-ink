"use client";

import { useOptimistic } from "react";
import { setPersonaDepth } from "@/app/notes/actions/configure-persona";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { planForDepth } from "@/lib/notegen/depth-policy";
import type { PersonaConfig, PersonaPreview } from "@/lib/notes/get-personas-screen";
import type { PersonaDepth } from "@/lib/notes/view-types";
import { NOT_YET } from "./persona-switcher-rail";
import { PersonaPreviewCard } from "./persona-preview-card";
import { DepthControl } from "./depth-control";
import { QuickActionsEditor } from "./quick-actions-editor";
import { DefaultLensButton } from "./default-lens-button";
import { usePersonaWrite } from "./use-persona-write";

/**
 * One persona's anatomy, App Surfaces 03's right-hand pane.
 *
 * WRITABLE since 2026-09-09: depth, quick actions and which lens new notes
 * open on. `+ New persona` and `Duplicate` stay disabled, and no control
 * deletes — creating and deleting a persona is the Advanced phase
 * (docs/ROADMAP.md §8), and a delete surface is additionally blocked on the
 * decision supabase/schemas/note_chunks.sql names. Configuring the four
 * provisioned rows is a different job from authoring a fifth.
 *
 * Nothing on this screen is invented. The framing paragraph is read from
 * lib/notegen/lens-prompts.ts by slug — the same lookup the generator hands
 * Gemini — and the depth and output-shape lines are derived from
 * lib/notegen/depth-policy.ts. Copying either into a second file would let the
 * screen and the pipeline drift.
 *
 * THE OPTIMISTIC DEPTH LIVES HERE, not in depth-control.tsx, because two rows
 * read it: the segmented control's own derived line, and Output shape below.
 * Split across two owners they disagree for the length of a round trip, which
 * on this screen means a line reading "no summary" beside a chip reading
 * "summary ×1".
 */

const ROW = "border-rule-2 grid grid-cols-[110px_minmax(0,1fr)] gap-[18px] border-b py-[16px]";
const ROW_LABEL =
  "font-mono text-meta text-[9px] leading-[1.7] tracking-[0.11em] uppercase";
const CHIP = "font-mono bg-pane text-ink-2 px-[10px] py-[5px] text-[9.5px]";
const ACCENT_CHIP = "font-mono bg-tint text-accent-text px-[10px] py-[5px] text-[9.5px]";
const DEAD_CONTROL =
  "border-rule-2 text-faint font-mono cursor-not-allowed border text-[10px] tracking-[0.06em] uppercase";
const SOON = "font-mono text-muted text-[8.5px] tracking-[0.14em] uppercase";

/** The reader's own words for what setPersonaDepth refuses. */
const REFUSED = {
  invalid: "That depth is not one of Brief, Dense or Exhaustive.",
} as const;

/** What the pipeline will actually return at this depth, said in the schema's
 *  own terms. Derived, never a written-down list. */
function outputShape(depth: PersonaDepth): string[] {
  const plan = planForDepth(depth);
  return [
    "title ×1",
    ...(plan.wantsSummary ? ["summary ×1"] : []),
    "takeaway ×n",
    "action_item ×n",
    `scope · ${plan.scope}`,
  ];
}

export function PersonaAnatomy({
  persona,
  preview,
  defaultPersonaId,
  lastNoteId,
  lastNoteTitle,
}: {
  persona: PersonaConfig;
  preview: PersonaPreview | undefined;
  defaultPersonaId: string;
  lastNoteId: string | null;
  lastNoteTitle: string | null;
}) {
  const lens = lensPromptFor(persona.id);
  const depthWrite = usePersonaWrite(REFUSED);
  const [depth, setDepth] = useOptimistic(persona.depth);

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="border-rule flex items-end gap-[14px] border-b px-[26px] pt-[20px] pb-[15px]">
        <div>
          <p className="font-mono text-meta text-[9px] tracking-[0.14em] uppercase">
            Persona
          </p>
          <h2 className="font-header text-ink mt-[5px] text-[26px] font-semibold tracking-[-0.012em]">
            {persona.name}
          </h2>
        </div>
        <div className="ml-auto flex flex-none items-center gap-[8px]">
          <span title={NOT_YET}>
            <button
              type="button"
              disabled
              className={`${DEAD_CONTROL} flex items-center gap-[8px] px-[11px] py-[7px]`}
            >
              <span className="opacity-60">Duplicate</span>
              <span className={SOON}>Soon</span>
            </button>
          </span>
          <DefaultLensButton
            slug={persona.id}
            defaultPersonaId={defaultPersonaId}
          />
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[26px] pb-[24px]">
        <div className={ROW}>
          <p className={ROW_LABEL}>Lens</p>
          <div>
            <p className="font-body text-ink-prose text-[14px] leading-[1.6] text-pretty">
              {lens.framing}
            </p>
            {/* One chip, not the drawing's row of five. Five would be a second
                switcher beside the rail that already switches. */}
            <p className="mt-[9px]">
              <span className={ACCENT_CHIP}>{lens.slug}</span>
            </p>
          </div>
        </div>

        <div className={ROW}>
          <p className={ROW_LABEL}>Depth</p>
          <DepthControl
            value={depth}
            pending={depthWrite.pending}
            message={depthWrite.message}
            onSelect={(next) =>
              depthWrite.run(async () => {
                setDepth(next);
                return setPersonaDepth(persona.id, next);
              })
            }
          />
        </div>

        <div className={ROW}>
          <p className={ROW_LABEL}>Quick actions</p>
          <QuickActionsEditor slug={persona.id} actions={persona.actions} />
        </div>

        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-[18px] py-[16px]">
          <p className={ROW_LABEL}>Output shape</p>
          <div>
            <div className="flex flex-wrap gap-[6px]">
              {outputShape(depth).map((shape) => (
                <span key={shape} className={CHIP}>
                  {shape}
                </span>
              ))}
              <span className={ACCENT_CHIP}>every claim cited</span>
            </div>
            <PersonaPreviewCard
              preview={preview}
              personaName={persona.name}
              lastNoteId={lastNoteId}
              lastNoteTitle={lastNoteTitle}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
