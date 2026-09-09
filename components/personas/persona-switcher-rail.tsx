"use client";

import type { PersonaConfig } from "@/lib/notes/get-personas-screen";

/**
 * The Personas screen's left rail, App Surfaces 03.
 *
 * A SWITCHER, not the note-detail persona rail. That one picks the lens one
 * note will generate under and freezes; this one picks which lens's
 * configuration the pane on the right is showing, and freezes never. They
 * share a drawing and nothing else, which is why this is its own component
 * rather than a prop on components/note-detail/persona-rail.tsx.
 *
 * Four rows, not the drawing's five. `Interviewer` has no personas row and no
 * lens framing in lib/notegen/lens-prompts.ts, so rendering it would be a
 * fifth lens the generation pipeline cannot run.
 */

const LABEL = "font-mono text-meta text-[8.5px] tracking-[0.14em] uppercase";

/** Custom personas are an Advanced-phase item — docs/ROADMAP.md §8. Rendered
 *  rather than hidden, and genuinely inert, the way the dashboard rail renders
 *  its unbuilt nav. `title` on the wrapper, not the button: browsers suppress
 *  pointer events on a disabled element, so a tooltip on the control itself
 *  provably never appears. */
export const NOT_YET =
  "Custom personas are not built yet — the four built-in lenses are rows the signup trigger seeds.";

export function PersonaSwitcherRail({
  personas,
  selectedId,
  onSelect,
}: {
  personas: PersonaConfig[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r">
      <div className="border-rule-3 border-b px-[15px] pt-[15px] pb-[11px]">
        <h1 className="font-header text-ink text-[16px] font-semibold">
          Personas
        </h1>
        {/* The count is read, not written down. Four rows today; an account
            provisioned differently says what it actually has. */}
        <p className={`${LABEL} mt-[4px]`}>
          {personas.length} built-in · custom coming
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Persona"
        aria-orientation="vertical"
        className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto py-[8px]"
      >
        {personas.map((persona) => {
          const selected = persona.id === selectedId;
          return (
            <button
              key={persona.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(persona.id)}
              className={[
                // border-accent, not border-tint-hover and not border-rule-2:
                // this is the edge of an INTERACTIVE control, and CLAUDE.md
                // § Colour keeps the two families apart on purpose.
                "cursor-pointer border-l-2 px-[14px] py-[10px] text-left",
                "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
                selected
                  ? "border-accent bg-raised"
                  : "hover:bg-pane border-transparent",
              ].join(" ")}
            >
              <span
                className={`font-header block text-[14.5px] font-semibold ${
                  selected ? "text-ink" : "text-rail-idle"
                }`}
              >
                {persona.name}
              </span>
              {/* personas.sub is a real column. The drawing's strings are the
                  seeded values of it; nothing here restates them. */}
              <span className="font-mono text-meta mt-[3px] block text-[9px] uppercase">
                {persona.sub}
              </span>
            </button>
          );
        })}

        <span title={NOT_YET} className="mt-[2px] block px-[8px]">
          <button
            type="button"
            disabled
            className="border-rule-2 text-faint font-header flex w-full cursor-not-allowed items-center gap-[8px] border border-dashed px-[6px] py-[8px] text-left text-[14.5px]"
          >
            <span className="opacity-60">+ New persona</span>
            <span className="font-mono text-muted ml-auto text-[8.5px] tracking-[0.14em] uppercase">
              Soon
            </span>
          </button>
        </span>
      </div>

      <div className="border-rule-3 font-mono text-meta mt-auto border-t px-[15px] py-[11px] text-[9px] leading-[1.7]">
        <span className="flex">
          applies to
          <span className="text-notice ml-auto">new notes</span>
        </span>
        {/* The drawing says "re-run cost · free". There is no re-run:
            docs/DECISIONS.md § Personas rejected regeneration on 2026-08-30,
            and the lens a note generated under is a fact about that note. */}
        <span className="flex">
          re-run
          <span className="text-notice ml-auto">not offered</span>
        </span>
      </div>
    </div>
  );
}
