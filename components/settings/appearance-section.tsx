"use client";

import { useTheme, type Theme } from "@/components/theme-toggle";
import { GroupLabel, SectionFrame } from "./section-frame";

/**
 * Appearance, App Surfaces 06.
 *
 * THE SAME MECHANISM AS THE CORNER TOGGLE, not a second one. Both read and
 * write through components/theme-toggle.tsx's useTheme, whose store is the
 * class on <html> — so this page and the toggle cannot disagree about the
 * current theme, because neither holds a copy of it.
 *
 * INSTANT, and outside the Update/Discard bar. The corner toggle applies on
 * click; making someone press Update to keep a theme they can already see
 * would be worse than what already ships. So this section registers no dirty
 * state.
 *
 * Two cards, not the drawing's three. "Match system · switches at sunset" is
 * continuous OS-following with time-of-day switching, and neither exists: the
 * boot script in app/layout.tsx reads prefers-color-scheme once, only when
 * nothing is stored, and never again.
 *
 * Each preview wears its own theme's tokens by carrying the theme class on
 * the preview itself — `.dark` and `.light` both work on a subtree (see the
 * top of app/globals.css) — so the thumbnails stay true whichever theme the
 * page is in, with no colour named here.
 */

const THEMES: { id: Theme; name: string }[] = [
  { id: "dark", name: "Espresso Dark" },
  { id: "light", name: "Newsprint Light" },
];

export function AppearanceSection() {
  const [theme, setTheme] = useTheme();

  return (
    <SectionFrame
      id="appearance"
      title="Appearance"
      lede="Applies the moment you pick it, in this browser."
    >
      <GroupLabel>Theme</GroupLabel>
      <div className="mt-[11px] flex gap-[12px]">
        {THEMES.map((option) => {
          const active = option.id === theme;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              suppressHydrationWarning
              onClick={() => setTheme(option.id)}
              className={`focus-visible:outline-accent w-[180px] cursor-pointer border p-[9px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${
                active ? "border-accent" : "border-control-edge hover:bg-raised"
              }`}
            >
              <span
                aria-hidden
                className={`${option.id} bg-canvas border-rule flex h-[52px] border`}
              >
                <span className="bg-rail border-rule w-[34px] border-r" />
                <span className="flex-1 p-[7px]">
                  <span className="bg-faint block h-[5px] w-[60%]" />
                  <span className="bg-rule mt-[5px] block h-[5px] w-[80%]" />
                  <span className="bg-accent mt-[5px] block h-[5px] w-[40%]" />
                </span>
              </span>
              <span className="font-mono mt-[8px] flex items-center text-[9.5px] uppercase">
                <span className={active ? "text-ink" : "text-notice"}>{option.name}</span>
                {active ? <span className="text-accent-text ml-auto">Active</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </SectionFrame>
  );
}
