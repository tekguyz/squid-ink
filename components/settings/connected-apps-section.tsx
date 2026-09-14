"use client";

import { useState } from "react";
import { SectionFrame } from "./section-frame";

/**
 * Connected apps, App Surfaces 06.
 *
 * A UI STUB this phase, by decision (docs/DECISIONS.md § Settings). The
 * buttons are full-fidelity and clickable; pressing one says plainly that the
 * connection is not built. No OAuth flow, no token storage, no connections
 * table. It does not fake success and it does not silently do nothing.
 *
 * Copy is written in the conditional ("would read…") because nothing here
 * reads anything yet. The drawing's "revocable here" is gone for the same
 * reason — there is nothing to revoke.
 *
 * The drawing's third row, "Meeting apps · detected locally", does not ship:
 * nothing in this repo detects a meeting app, and an ACTIVE badge beside Meet,
 * Zoom and Teams would be a claim with no code under it.
 *
 * No dirty state: a stub has nothing to save, so this section does not
 * register with the footer.
 */

const APPS = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    scope: "Would read events · titles, times, attendees",
    purpose: "Would match a recording to the meeting it belongs to and pre-title the note.",
    primary: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    scope: "Would read files you pick · no browsing",
    purpose:
      "Would let you attach a doc as an imported source the model can cite beside the transcript.",
    primary: false,
  },
] as const;

const BUTTON =
  "focus-visible:outline-accent cursor-pointer py-[8px] text-center font-mono text-[9.5px] tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2";

export function ConnectedAppsSection() {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());

  return (
    <SectionFrame
      id="connected-apps"
      title="Connected apps"
      lede="Nothing is connected. Connecting is never required to record."
    >
      {APPS.map((app) => {
        const tried = pressed.has(app.id);
        return (
          <div
            key={app.id}
            className="border-rule-3 grid grid-cols-[minmax(0,1fr)_300px_120px] items-center gap-[16px] border-b py-[15px]"
          >
            <div>
              <p className="font-header text-ink text-[15px] font-semibold">{app.name}</p>
              <p className="font-mono text-meta-2 mt-[4px] text-[9.5px] uppercase">
                {app.scope}
              </p>
            </div>
            <div>
              <p className="font-body text-muted text-[12.5px] leading-[1.5]">{app.purpose}</p>
              {/* Rendered empty and filled on press, so the live region exists
                  before its text changes and the change is announced. */}
              <p
                role="status"
                className="font-mono text-notice mt-[4px] text-[9.5px] uppercase empty:hidden"
              >
                {tried ? "Not connected yet · Google connect is not built" : ""}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Connect ${app.name}`}
              onClick={() => setPressed((previous) => new Set(previous).add(app.id))}
              className={
                app.primary
                  ? `${BUTTON} bg-accent text-on-accent hover:bg-accent-pressed font-medium`
                  : `${BUTTON} border-control-edge text-ink-2 hover:bg-raised border`
              }
            >
              {tried ? "Not yet" : "Connect"}
            </button>
          </div>
        );
      })}
    </SectionFrame>
  );
}
