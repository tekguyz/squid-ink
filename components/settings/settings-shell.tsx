"use client";

import { useCallback, useRef, useState } from "react";
import { HUD_RESERVE_VAR } from "@/components/recorder/hud-safe-margin";
import type { SettingsScreen } from "@/lib/settings/settings-types";
import { AppearanceSection } from "./appearance-section";
import { CaptureSection } from "./capture-section";
import { ConnectedAppsSection } from "./connected-apps-section";
import { DirtyRegistryProvider } from "./dirty-registry";
import { NotBuiltYet, SectionFrame } from "./section-frame";
import { SettingsFooter } from "./settings-footer";
import { SECTION_IDS, SettingsNav, type SectionId } from "./settings-nav";
import { useDemo } from "@/components/demo/demo-mode";

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
 * Held at 1280px and scrolled sideways from there down to 1024px. Below
 * 1024px the nav stacks above the settings (issue #23), the Dashboard's
 * pattern in app/page.tsx.
 */

/** How far below the scroll container's top a section's top may sit and still
 *  count as the one being read. */
const ACTIVE_OFFSET = 24;

export function SettingsShell({ screen }: { screen: SettingsScreen }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>("account");
  // Issue #19: a demo visitor has no email and no password, so Account says
  // what a visit is instead of pointing at a reset they cannot use.
  const demo = useDemo();

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
    <div className="scroll-thin h-app overflow-x-auto overflow-y-hidden max-lg:overflow-x-hidden">
      {/* Stacked, the sections run under the Record pill, so the grid ends
          HUD_RESERVE above the bottom — unless the footer is there, which
          already is that band. */}
      <div
        style={HUD_RESERVE_VAR}
        className="bg-paper text-ink grid h-full min-w-[1280px] max-lg:pb-(--hud-reserve) max-lg:has-[footer]:pb-0 grid-cols-[210px_minmax(0,1fr)] max-lg:min-w-0 max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)]"
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
                lede={
                  demo
                    ? "A demo visit has no account."
                    : "You sign in with the email address shown in the rail."
                }
              >
                {demo ? (
                  // Not NotBuiltYet: nothing is missing here, a visit simply
                  // has no account. Its body type, without the label.
                  <p className="font-body text-muted max-w-[560px] py-[15px] text-[12.5px] leading-[1.5]">
                    This visit reads sample notes and ends after seven days. Leave demo, in
                    the rail, ends it now.
                  </p>
                ) : (
                  <NotBuiltYet>
                    There is no profile or display name to change. You sign in with your
                    email and password; to change the password, use “Forgot your
                    password?” on the sign-in page.
                  </NotBuiltYet>
                )}
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
