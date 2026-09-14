"use client";

import Link from "next/link";
import { signOut } from "@/app/notes/actions/session";

/**
 * The Settings left rail, App Surfaces 06.
 *
 * SCROLL ANCHORS, not tabs. The page is one continuous scroll; each item links
 * to a section's id and the shell tracks which one is in view. Personas is the
 * exception: it already has a screen, so it links to /personas rather than
 * growing a second copy here.
 *
 * The identity line is the signed-in address and nothing else. The drawing's
 * org-style address stands in for a workspace this product rejects
 * indefinitely (docs/ROADMAP.md §7) — no org string, no switcher.
 *
 * "All notes" is not in the drawing. Without it the only way off this page is
 * the browser's back button.
 */

export type SectionId =
  | "account"
  | "capture"
  | "connected-apps"
  | "appearance"
  | "sharing"
  | "data-privacy";

type NavItem =
  | { kind: "anchor"; id: SectionId; label: string }
  | { kind: "link"; href: string; label: string };

export const NAV_ITEMS: NavItem[] = [
  { kind: "anchor", id: "account", label: "Account" },
  { kind: "anchor", id: "capture", label: "Capture & audio" },
  { kind: "link", href: "/personas", label: "Personas" },
  { kind: "anchor", id: "connected-apps", label: "Connected apps" },
  { kind: "anchor", id: "appearance", label: "Appearance" },
  { kind: "anchor", id: "sharing", label: "Sharing" },
  { kind: "anchor", id: "data-privacy", label: "Data & privacy" },
];

/** In page order — what the shell's scroll tracking walks. */
export const SECTION_IDS = NAV_ITEMS.flatMap((item) =>
  item.kind === "anchor" ? [item.id] : [],
);

const ITEM =
  "font-body focus-visible:outline-accent block border-l-2 px-[14px] py-[8px] text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2";
const IDLE = "text-ink-2 hover:bg-pane border-transparent";

export function SettingsNav({
  email,
  active,
  onSelect,
}: {
  email: string | null;
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav
      aria-label="Settings"
      className="bg-rail border-rule flex min-h-0 flex-col overflow-hidden border-r pt-[16px]"
    >
      <div className="flex items-center gap-[8px] px-[14px] pb-[12px]">
        <span className="font-mono text-meta-2 min-w-0 truncate text-[9px] uppercase">
          {email ?? "Signed in"}
        </span>
        <Link
          href="/"
          className="font-mono text-muted hover:text-ink focus-visible:outline-accent ml-auto flex-none text-[9px] uppercase focus-visible:outline-2"
        >
          All notes
        </Link>
      </div>

      <div className="flex flex-col">
        {NAV_ITEMS.map((item) =>
          item.kind === "link" ? (
            <Link key={item.href} href={item.href} className={`${ITEM} ${IDLE}`}>
              {item.label}
            </Link>
          ) : (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => onSelect(item.id)}
              aria-current={item.id === active ? "location" : undefined}
              className={`${ITEM} ${
                item.id === active
                  ? "bg-raised border-accent text-ink font-medium"
                  : IDLE
              }`}
            >
              {item.label}
            </a>
          ),
        )}
      </div>

      <div className="border-rule-3 mt-auto border-t px-[14px] py-[12px]">
        {/* A form, so sign-out works before hydration and needs no client
            handler. The action signs out THIS browser only — see
            app/notes/actions/session.ts for why not every session. */}
        <form action={signOut}>
          <button
            type="submit"
            className="border-danger text-danger hover:bg-raised focus-visible:outline-accent w-full cursor-pointer border px-[10px] py-[6px] text-center font-mono text-[9.5px] tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Log me out
          </button>
        </form>
      </div>
    </nav>
  );
}
