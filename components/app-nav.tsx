import Link from "next/link";

/**
 * The app's own navigation, at the top of EVERY main screen's left rail —
 * All notes, Personas, Collections, Settings. Added 2026-09-13.
 *
 * Before it, only the Dashboard rail carried these links: /personas and
 * /notes/[id] had no way back but the browser's Back button, and Collections
 * and Settings each grew a one-off "All notes" link of their own. One
 * component, mounted in each screen's existing rail, rather than a new column
 * beside it — no screen gets narrower, and the block is identical everywhere.
 *
 * Presentational, no state. `current` marks the screen you are on; a note page
 * passes nothing, because a note is not one of these four places.
 */

export type AppSection = "notes" | "personas" | "collections" | "settings";

const ITEMS: { id: AppSection; href: string; label: string }[] = [
  { id: "notes", href: "/", label: "All notes" },
  { id: "personas", href: "/personas", label: "Personas" },
  { id: "collections", href: "/collections", label: "Collections" },
  { id: "settings", href: "/settings", label: "Settings" },
];

/** Where a screen stacks its rail above its content, the links become one
 *  row that scrolls on its own (issue #23). Whole class strings, because
 *  Tailwind cannot build a class name at runtime. The note stacks its rail
 *  only below 768px; every other screen below 1024px. */
const ROW_BELOW = {
  md: {
    nav: "scroll-thin max-md:flex-row max-md:overflow-x-auto",
    item: "max-md:flex-none max-md:whitespace-nowrap",
  },
  lg: {
    nav: "scroll-thin max-lg:flex-row max-lg:overflow-x-auto",
    item: "max-lg:flex-none max-lg:whitespace-nowrap",
  },
} as const;

const ITEM =
  "font-body focus-visible:outline-accent flex items-center gap-[9px] border-l-2 px-[8px] py-[6px] text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2";

export function AppNav({
  current,
  notesCount,
  rowBelow,
}: {
  current?: AppSection;
  rowBelow?: keyof typeof ROW_BELOW;
  /** Shown beside All notes on the Dashboard, which is the one screen that
   *  has the number to hand. */
  notesCount?: number;
}) {
  return (
    <nav
      aria-label="App"
      className={`border-rule-3 flex flex-none flex-col gap-px border-b px-[8px] pt-[10px] pb-[8px] ${rowBelow ? ROW_BELOW[rowBelow].nav : ""}`}
    >
      {ITEMS.map((item) => {
        const active = item.id === current;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${ITEM} ${rowBelow ? ROW_BELOW[rowBelow].item : ""} ${
              active
                ? "bg-raised border-accent text-ink"
                : "text-ink-2 hover:bg-raised border-transparent"
            }`}
          >
            {item.label}
            {item.id === "notes" && notesCount !== undefined ? (
              <span
                className="font-mono text-muted ml-auto text-[9.5px] tabular-nums"
                aria-label={`${notesCount} notes`}
              >
                {notesCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
