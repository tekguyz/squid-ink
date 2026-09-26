"use client";

import { useCallback, useRef, useState } from "react";
import type { SettingsScreen } from "@/lib/settings/settings-types";
import { AppearanceSection } from "./appearance-section";
import { CaptureSection } from "./capture-section";
import { ConnectedAppsSection } from "./connected-apps-section";
import { DirtyRegistryProvider } from "./dirty-registry";
import { NotBuiltYet, SectionFrame } from "./section-frame";
import { SettingsFooter } from "./settings-footer";
import { SECTION_IDS, SettingsNav, type SectionId } from "./settings-nav";

/**
 * Settings, App Surfaces 06.
 *
 * ONE ROUTE, ONE CONTINUOUS SCROLL. The nav's items are anchors into this
 * scroll, and the highlighted item follows what is in view. Each section with
 * real content is its own component owning its own draft and dirty state —
 * decided 2026-09-13, docs/DECISIONS.md § Settings.
 *
 * Two sections are real: Connected apps (a stub, honestly
 * labelled) and Appearance. Account, Capture & audio, Sharing and Data &
 * privacy are nav destinations with nothing built behind them, and say so.
 *
 * Held at MIN_SURFACE_WIDTH and scrolled sideways below it, the same interim
 * treatment app/page.tsx documents.
 */
const MIN_SURFACE_WIDTH = 1280;

/** How far below the scroll container's top a section's top may sit and still
 *  count as the one being read. */
const ACTIVE_OFFSET = 24;

export function SettingsShell({ screen }: { screen: SettingsScreen }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>("account");

  // Measured on scroll rather than with an IntersectionObserver: the last
  // sections are short, and "the last section whose top has passed the top
  // edge, or the last one once the scroll bottoms out" is the rule a reader
  // expects. Six offsetTop reads per scroll event is nothing.
  const onScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const scrollable = root.scrollHeight > root.clientHeight;
    const bottomedOut = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    if (scrollable && bottomedOut) {
      setActive(SECTION_IDS[SECTION_IDS.length - 1]);
      return;
    }
    let current = SECTION_IDS[0];
    for (const id of SECTION_IDS) {
      const section = document.getElementById(id);
      if (section && section.offsetTop <= root.scrollTop + ACTIVE_OFFSET) current = id;
    }
    setActive(current);
  }, []);

  return (
    <div className="scroll-thin h-dvh overflow-x-auto overflow-y-hidden">
      <div
        style={{ minWidth: MIN_SURFACE_WIDTH }}
        className="bg-paper text-ink grid h-full grid-cols-[210px_minmax(0,1fr)]"
      >
        <SettingsNav email={screen.email} active={active} onSelect={setActive} />

        <DirtyRegistryProvider>
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <h1 className="sr-only">Settings</h1>
            {/* `relative` makes this the offsetParent, so a section's
                offsetTop is measured in this scroll's coordinates. */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="scroll-thin relative min-h-0 flex-1 overflow-y-auto"
            >
              <SectionFrame
                id="account"
                title="Account"
                lede="You sign in with the email address shown in the rail."
              >
                <NotBuiltYet>
                  There is no profile, display name or password to change. Sign-in is by
                  emailed link only.
                </NotBuiltYet>
              </SectionFrame>

              <CaptureSection />
              <ConnectedAppsSection />
              <AppearanceSection />

              <SectionFrame
                id="sharing"
                title="Sharing"
                lede="Who else can read a note."
              >
                <NotBuiltYet>
                  Notes cannot be shared yet. Every note is visible to this account only.
                </NotBuiltYet>
              </SectionFrame>

              <SectionFrame
                id="data-privacy"
                title="Data & privacy"
                lede="What is kept, and for how long."
              >
                <NotBuiltYet>
                  There is no export, no retention schedule and no account deletion here yet.
                </NotBuiltYet>
              </SectionFrame>
            </div>
            <SettingsFooter />
          </main>
        </DirtyRegistryProvider>
      </div>
    </div>
  );
}
