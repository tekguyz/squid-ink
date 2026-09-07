import { NoteRow } from "@/components/dashboard/note-row";
import type { DayGroup } from "@/lib/notes/group-notes-by-day";

/**
 * The day-grouped feed, App Surfaces 01.
 *
 * The day heading is the only structure between rows — no cards, no panels.
 * Grouping is done in lib/notes/group-notes-by-day.ts, which is pure and
 * tested; this file renders what it returns and decides nothing.
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
        <section key={group.key} aria-label={group.label}>
          <h2 className="flex items-center gap-[10px] px-[24px] pt-[14px] pb-[7px]">
            <span className="font-mono text-muted text-[8.5px] tracking-[0.16em] uppercase">
              {group.label}
            </span>
            <span aria-hidden className="bg-rule h-px flex-1" />
          </h2>
          {group.notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </section>
      ))}
    </>
  );
}
