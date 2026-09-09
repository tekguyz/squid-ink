"use client";

import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { planForDepth } from "@/lib/notegen/depth-policy";
import type { PersonaConfig, PersonaPreview } from "@/lib/notes/get-personas-screen";
import type { PersonaDepth } from "@/lib/notes/view-types";
import { NOT_YET } from "./persona-switcher-rail";
import { PersonaPreviewCard } from "./persona-preview-card";

/**
 * One persona's anatomy, App Surfaces 03's right-hand pane.
 *
 * READ-ONLY. Every control here renders and none of them writes — the
 * mutations are the next piece of work. They are rendered rather than hidden
 * for the reason components/dashboard/identity-rail.tsx gives about its own
 * unbuilt nav: a surface that grows a control later is worse than one that
 * says what is coming.
 *
 * Nothing on this screen is invented. The framing paragraph is read from
 * lib/notegen/lens-prompts.ts by slug — the same lookup the generator hands
 * Gemini — and the depth and output-shape lines are derived from
 * lib/notegen/depth-policy.ts. Copying either into a second file would let the
 * screen and the pipeline drift.
 */

const ROW = "border-rule-2 grid grid-cols-[110px_minmax(0,1fr)] gap-[18px] border-b py-[16px]";
const ROW_LABEL =
  "font-mono text-meta text-[9px] leading-[1.7] tracking-[0.11em] uppercase";
const CHIP = "font-mono bg-pane text-ink-2 px-[10px] py-[5px] text-[9.5px]";
const ACCENT_CHIP = "font-mono bg-tint text-accent-text px-[10px] py-[5px] text-[9.5px]";
const DEAD_CONTROL =
  "border-rule-2 text-faint font-mono cursor-not-allowed border text-[10px] tracking-[0.06em] uppercase";
const SOON = "font-mono text-muted text-[8.5px] tracking-[0.14em] uppercase";

const DEPTHS: PersonaDepth[] = ["brief", "dense", "exhaustive"];

/** Depth is display-only until the write ships. `title` sits on a wrapper
 *  because a disabled element receives no pointer events. */
const DEPTH_PENDING =
  "Depth is read-only on this screen for now — changing it is the next piece of work.";
const ACTIONS_PENDING =
  "Quick actions are read-only on this screen for now — editing them is the next piece of work.";
const NO_DEFAULT_SWITCH =
  "The default lens is the neutral-analyst slug and is not a per-account setting.";

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
  lastNoteId,
  lastNoteTitle,
}: {
  persona: PersonaConfig;
  preview: PersonaPreview | undefined;
  lastNoteId: string | null;
  lastNoteTitle: string | null;
}) {
  const lens = lensPromptFor(persona.id);
  const plan = planForDepth(persona.depth);

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
          <span title={NO_DEFAULT_SWITCH}>
            <button
              type="button"
              disabled
              className={`${DEAD_CONTROL} flex items-center gap-[8px] px-[11px] py-[7px]`}
            >
              <span className="opacity-60">Set as default</span>
              <span className={SOON}>Soon</span>
            </button>
          </span>
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
          <div>
            <span title={DEPTH_PENDING} className="inline-block">
              <span
                role="group"
                aria-label="Depth"
                className="border-rule-2 flex w-fit border"
              >
                {DEPTHS.map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    disabled
                    aria-pressed={depth === persona.depth}
                    className={[
                      "font-mono cursor-not-allowed px-[13px] py-[6px] text-[10px] capitalize",
                      depth === persona.depth
                        ? "bg-tint text-accent-text"
                        : "text-faint",
                    ].join(" ")}
                  >
                    {depth}
                  </button>
                ))}
              </span>
            </span>
            <p className="font-mono text-meta mt-[8px] text-[9.5px] uppercase">
              {persona.depth} · {plan.scope} ·{" "}
              {plan.wantsSummary ? "summary included" : "no summary"} ·
              thinking {plan.thinkingLevel}
            </p>
          </div>
        </div>

        <div className={ROW}>
          <p className={ROW_LABEL}>Quick actions</p>
          <div className="flex flex-col gap-[5px]">
            {persona.actions.map((action) => (
              <p
                key={action}
                className="bg-pane font-body text-ink-2 px-[10px] py-[8px] text-[13px]"
              >
                {action}
              </p>
            ))}
            <span title={ACTIONS_PENDING}>
              <button
                type="button"
                disabled
                className={`${DEAD_CONTROL} flex w-full items-center gap-[8px] border-dashed px-[10px] py-[8px] text-left text-[9.5px]`}
              >
                <span className="opacity-60">+ Add quick action</span>
                <span className={SOON}>Soon</span>
              </button>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-[18px] py-[16px]">
          <p className={ROW_LABEL}>Output shape</p>
          <div>
            <div className="flex flex-wrap gap-[6px]">
              {outputShape(persona.depth).map((shape) => (
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
