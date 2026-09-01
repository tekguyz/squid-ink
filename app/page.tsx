import Link from "next/link";
import { listNotes } from "@/lib/notes/list-notes";
import { StatusPill } from "@/components/dashboard/status-pill";

/**
 * THROWAWAY SCAFFOLD — not a finished screen, and not the Dashboard.
 *
 * This exists so Track 2 (Recorder HUD) and Track 3 (transcription pipeline)
 * have a way to see that a note was created and to open it. The real
 * dashboard/feed is App Surface 01 in the design file and belongs to the Core
 * UX/UI phase; when that lands, this file is replaced wholesale. Deliberately
 * no design pass: minimal layout, existing tokens only, no new components.
 *
 * It previously redirected to the newest note. A redirect hides every other
 * note, which is exactly what needed to become visible.
 */
export default async function Home() {
  const notes = await listNotes();

  if (notes.length === 0) {
    return (
      <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
        <h1 className="font-header text-ink">No notes yet</h1>
        <p className="font-body text-ink-2">
          Once a recording finishes processing, it will show up here.
        </p>
      </main>
    );
  }

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col gap-4 p-6">
      <h1 className="font-header text-ink">Your notes</h1>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id}>
            <Link href={`/notes/${note.id}`} className="font-body text-ink block underline">
              {note.title ?? "Untitled"}
            </Link>
            {/* Wraps rather than squeezing: the timestamp is one unbreakable
                token and the column is narrow, so the pill drops to its own
                line instead of splitting the date across two. */}
            <span className="mt-[3px] flex flex-wrap items-center gap-x-[7px] gap-y-[3px]">
              <span className="font-mono text-ink-2 text-xs whitespace-nowrap">
                {note.createdAt}
              </span>
              <StatusPill status={note.processingStatus} />
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
