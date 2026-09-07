import { NoteRow } from "@/components/dashboard/note-row";
import type { DayGroup } from "@/lib/notes/group-notes-by-day";

/**
 * The day-grouped feed, App Surfaces 01.
 *
 * The day heading is the only structure between rows — no cards, no panels.
 * Grouping is done in lib/notes/group-notes-by-day.ts, which is pure and
 * tested; this file renders what it returns and decides nothing.
 *
 * The heading's leading space is 26px because it has to beat the pitch of the
 * thing it groups, and it did not. Measured 2026-09-07: the margin above the
 * heading box was 0, its own pt-[14px] put the label 14px below the boundary,
 * while two rows INSIDE one group sit 22px apart plus a visible hairline. The
 * day break was the weaker separation, so the eye found rows before days and
 * the labels had to be read rather than seen. NoteRow drops its bottom rule on
 * a group's last row for the same reason — the whitespace is what carries the
 * boundary, because every rule token measures under 1.5:1 and is a texture.
 *
 * The section carries no aria-label: the h2 inside it already names the group,
 * and both together made a screen reader announce each day twice.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */
export function NoteFeed({ groups }: { groups: DayGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-[9px] px-[24px] pt-[40px]">
        <p className="font-header text-ink text-[16px] font-semibold">No notes yet</p>
        <p className="font-body text-muted max-w-[46ch] text-[13px]">
          Press Record and this feed fills in. A recording appears here the moment
          it starts uploading, and its transcript follows.
        </p>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="flex items-center px-[24px] pt-[26px] pb-[9px]">
            <span className="font-mono text-muted text-[8.5px] tracking-[0.16em] uppercase">
              {group.label}
            </span>
          </h2>
          {group.notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </section>
      ))}
    </>
  );
}
