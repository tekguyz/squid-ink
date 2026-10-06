"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { PhoneMenu } from "@/components/phone-menu";
import type { Persona } from "@/lib/notes/view-types";

export interface PersonaRailProps {
  personas: Persona[];
  selectedId: string;
  quickActions: string[];
  spansLinked: number;
  /** True once the note's lens is frozen — generation has been committed to,
   *  either by reaching notegen_status or by Transcribe having been pressed.
   *
   *  The lens a note generated under is a FACT about that note, not a filter
   *  over it: docs/DECISIONS.md § Personas rejected regeneration on
   *  2026-08-30. This is the UX half of enforcing that; the half that actually
   *  holds is the guarded UPDATE in app/notes/actions/persona.ts. */
  locked: boolean;
  onSelect: (personaId: string) => void;
  /** Issue #23: the rail is a pane that hides. The shell owns the state. */
  id?: string;
  hidden?: boolean;
  hideButton?: ReactNode;
}

const LABEL =
  "font-mono text-[8.5px] tracking-[0.14em] uppercase text-meta";

/** A NATIVE `disabled`, not the `aria-disabled` transcribe-button.tsx uses.
 *  The difference is deliberate and worth stating, because the two controls
 *  sit on the same screen and look inconsistent otherwise.
 *
 *  That button stays focusable because it has something to announce — a
 *  'failed' note's prose explains an outcome the reader needs. A locked lens
 *  announces nothing a screen reader does not already get from aria-selected,
 *  so removing it from the tab order costs no information and correctly says
 *  "this is not actionable". */

export function PersonaRail({
  personas,
  selectedId,
  quickActions,
  spansLinked,
  locked,
  onSelect,
  id,
  hidden = false,
  hideButton,
}: PersonaRailProps) {
  return (
    // Below 768px (issue #91) the rail is two rows above the note: a 48px
    // masthead (the way back and the phone menu), then ONE row that scrolls
    // sideways, holding the lens tabs and the quick actions together. The
    // second row's wrapper is `md:contents`, so from 768px up its children
    // are the rail's own and the drawn column is unchanged. The rail does not
    // hide on a phone, so neither does its button.
    <div
      id={id}
      hidden={hidden}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-rule-strong bg-rail md:in-data-[pane-lens=hidden]:hidden max-md:border-r-0 max-md:border-b"
    >
      <div className="border-rule-3 flex h-[48px] flex-none items-center justify-between border-b px-[16px] md:hidden">
        <Link
          href="/"
          aria-label="Back to all notes"
          className="font-mono text-ink-2 hover:bg-raised focus-visible:outline-accent -ml-[8px] flex h-[32px] items-center gap-[7px] px-[8px] text-[11px] tracking-[0.1em] uppercase focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <svg aria-hidden="true" viewBox="0 0 10 10" className="h-[10px] w-[10px]">
            <path d="M6.5 1.5 3 5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          All notes
        </Link>
        <PhoneMenu id="note-menu">
          <AppNav roomy />
        </PhoneMenu>
      </div>
      {/* The way back. Until 2026-09-13 a note page had none. */}
      <div className="contents max-md:hidden">
        <AppNav />
      </div>
      <div className={`flex items-center justify-between py-1.5 pr-1.5 pl-3 max-md:hidden ${LABEL}`}>
        Lens
        {hideButton}
      </div>

      <div className="scroll-thin md:contents max-md:flex max-md:h-[42px] max-md:flex-none max-md:items-stretch max-md:overflow-x-auto max-md:pr-[16px]">
      <span className={`flex flex-none items-center pr-[4px] pl-[16px] md:hidden ${LABEL} max-md:text-[11px] max-md:tracking-[0.1em]`}>
        Lens
      </span>
      <div
        role="tablist"
        aria-label="Summary lens"
        className="flex flex-col max-md:flex-none max-md:flex-row"
      >
        {personas.map((persona) => {
          const selected = persona.id === selectedId;
          return (
            <button
              key={persona.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={locked}
              title={persona.sub}
              onClick={() => onSelect(persona.id)}
              className={[
                "border-l-2 px-[11px] pt-2 pb-[9px] text-left max-md:flex-none max-md:border-b-2 max-md:border-l-0 max-md:whitespace-nowrap max-md:pt-[9px] max-md:pb-[8px]",
                "font-header text-[14px] font-semibold leading-[1.25]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                locked ? "cursor-default" : "cursor-pointer",
                selected
                  ? // The selected lens keeps full contrast even when locked.
                    // It is reporting which lens generated this note, and
                    // dimming it would hide the answer along with the control.
                    "border-accent bg-paper text-ink"
                  : locked
                    ? "border-transparent text-ink-disabled"
                    : "border-transparent text-rail-idle hover:bg-raised",
              ].join(" ")}
            >
              {persona.name}
            </button>
          );
        })}
      </div>

      <div className="max-md:hidden cursor-not-allowed border-l-2 border-transparent px-[11px] pt-2 pb-[9px] font-header text-[14px] leading-[20px] font-semibold text-ink-disabled">
        + New lens
      </div>

      <div className={`mt-[22px] px-3 pb-2 max-md:sr-only ${LABEL}`}>Actions</div>
      <div className="flex flex-col gap-1 px-2.5 max-md:my-[6px] max-md:ml-[6px] max-md:flex-none max-md:flex-row max-md:border-l max-md:border-rule-2 max-md:pr-0 max-md:pl-[10px]">
        {quickActions.map((action) => (
          <button
            key={action}
            type="button"
            className="max-md:flex max-md:flex-none max-md:items-center max-md:whitespace-nowrap max-md:text-[13px] cursor-pointer border border-control-edge bg-raised px-2 py-1.5 text-left text-[11.5px] leading-[1.35] text-ink-2 hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {action}
          </button>
        ))}
      </div>

      {/* This footer used to reserve a lane for the corner theme toggle. The
          toggle was removed on 2026-09-13 — Settings → Appearance replaced
          it — so the corner is free and the footer ends like any other. */}
      <div className="max-md:hidden mt-auto border-t border-rule px-3 pt-[11px] pb-[11px] font-mono text-[9px] leading-[1.7] text-meta">
        grounding
        <br />
        <span className="text-accent">{spansLinked} spans linked</span>
      </div>
      </div>
    </div>
  );
}
