"use client";

import { useState } from "react";
import { HUD_RESERVE_VAR } from "@/components/recorder/hud-safe-margin";
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
 * Held at 1280px and scrolled sideways from there down to 1024px. Below
 * 1024px the rail stacks above the content (issue #23), the Dashboard's
 * pattern in app/page.tsx: an ordinary narrow layout, not a designed one, and
 * every narrow rule is a max-lg:/max-md: variant so the drawn width is
 * untouched.
 */

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
    <div className="scroll-thin h-app overflow-x-auto overflow-y-hidden max-lg:overflow-x-hidden">
      {/* Stacked, the pane runs the full width, so the whole grid ends
          HUD_RESERVE above the bottom and no row passes under the Record
          pill. */}
      <div
        style={HUD_RESERVE_VAR}
        className="bg-paper text-ink grid h-full min-w-[1280px] max-lg:pb-(--hud-reserve) grid-cols-[236px_minmax(0,1fr)] max-lg:min-w-0 max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)]"
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
