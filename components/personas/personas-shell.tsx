"use client";

import { useState } from "react";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";
import type { PersonasScreen } from "@/lib/notes/get-personas-screen";
import { PersonaAnatomy } from "./persona-anatomy";
import { PersonaSwitcherRail } from "./persona-switcher-rail";

/**
 * The Personas screen, App Surfaces 03.
 *
 * The rail's selection is LOCAL and stays local. Note Detail's rail seeds a
 * real row on mount because the lens shown there has to be the lens the note
 * generates under; this rail selects a thing to CONFIGURE, so a write would be
 * a database round trip in exchange for nothing. The writes on this screen all
 * live in the pane, and all go through
 * app/notes/actions/configure-persona.ts.
 *
 * Held at MIN_SURFACE_WIDTH and scrolled sideways below it, the same interim
 * treatment app/page.tsx documents: one design exists, at one width, and
 * inventing a narrow layout here would be guessing at a decision this file
 * does not own.
 */
const MIN_SURFACE_WIDTH = 1280;

export function PersonasShell({ screen }: { screen: PersonasScreen }) {
  const [selectedId, setSelectedId] = useState(
    // The neutral lens when the account has it, otherwise the first row in
    // rail order — a persona set provisioned by another path still opens on
    // something rather than on nothing.
    screen.personas.find((p) => p.id === DEFAULT_PERSONA_ID)?.id ??
      screen.personas[0]?.id ??
      DEFAULT_PERSONA_ID,
  );

  const persona =
    screen.personas.find((p) => p.id === selectedId) ?? screen.personas[0];

  return (
    <div className="scroll-thin h-dvh overflow-x-auto overflow-y-hidden">
      <div
        style={{ minWidth: MIN_SURFACE_WIDTH }}
        className="bg-paper text-ink grid h-full grid-cols-[236px_minmax(0,1fr)]"
      >
        <PersonaSwitcherRail
          personas={screen.personas}
          selectedId={persona.id}
          onSelect={setSelectedId}
        />
        {/* KEYED BY LENS on purpose. The pane now holds per-lens client state
            — an optimistic depth and a half-typed quick action — and switching
            rows must reset both. Without the key, a draft typed for Investor
            would still be in the field under Sales Coach. */}
        <PersonaAnatomy
          key={persona.id}
          persona={persona}
          preview={screen.previews[persona.id]}
          defaultPersonaId={screen.defaultPersonaId}
          lastNoteId={screen.lastNoteId}
          lastNoteTitle={screen.lastNoteTitle}
        />
      </div>
    </div>
  );
}
