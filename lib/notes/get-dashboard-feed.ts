import { createClient } from "@/lib/supabase/server";
import {
  groupNotesByDay,
  type DayGroup,
  type FeedNoteInput,
  type NoteCounts,
} from "@/lib/notes/group-notes-by-day";
import type { ChunkMetadata, ChunkType, ProcessingStatus } from "@/lib/notes/types";

/**
 * Everything the Dashboard renders, in two queries.
 *
 * Neither filters on user_id. RLS supplies it, and a redundant filter would
 * mask an RLS failure instead of exposing it — the rule CLAUDE.md § Supabase
 * states, and the reason the chunk query below is not narrowed to the note ids
 * the first query returned. The two are issued together for the same reason
 * lib/notes/get-note.ts issues its three together: neither depends on the
 * other's result, so awaiting in sequence would add a whole round trip.
 *
 * The counts are the point of the second query. One query grouped in memory,
 * never one query per row: a feed of 128 notes would otherwise be 128 round
 * trips, which is the N+1 CLAUDE.md flags as the risk of showing per-row stats
 * at all.
 */

/** The three generated chunk types. `transcript_segment` is excluded on
 *  purpose — a long recording has hundreds, none of them are counted here, and
 *  fetching them would make this query the heaviest thing on the screen. */
const GENERATED: ChunkType[] = ["summary", "takeaway", "action_item"];

interface NoteQueryRow {
  id: string;
  title: string | null;
  created_at: string;
  processing_status: ProcessingStatus;
  audio_duration_seconds: number | null;
}

interface ChunkQueryRow {
  note_id: string;
  chunk_type: ChunkType;
  content: string;
  metadata: ChunkMetadata | null;
}

export interface DashboardFeed {
  /** The signed-in account. There is no display-name column, so the address is
   *  the identity — the design's team switcher and member count are scaffolding
   *  from a multi-tenant product this one is not (docs/ROADMAP.md §9). */
  email: string | null;
  totalNotes: number;
  groups: DayGroup[];
}

/** The first sentence-ish of the summary, for the feed's second line. */
function previewOf(content: string): string | null {
  const line = content.replace(/\s+/g, " ").trim();
  return line.length === 0 ? null : line;
}

/** Tally per note.
 *
 *  `spans` matches `spansLinked` in lib/notes/note-view-model.ts exactly —
 *  cited summary runs plus every takeaway plus every action item — so the
 *  number on the feed row and the number on the note itself cannot disagree.
 *  A summary chunk written before the runs split carries no `runs` and
 *  contributes no spans, which is what the detail screen also shows. */
function tally(rows: readonly ChunkQueryRow[]): Map<string, NoteCounts> {
  const counts = new Map<string, NoteCounts>();

  for (const row of rows) {
    const entry = counts.get(row.note_id) ?? { actions: 0, spans: 0 };

    if (row.chunk_type === "action_item") {
      entry.actions += 1;
      entry.spans += 1;
    } else if (row.chunk_type === "takeaway") {
      entry.spans += 1;
    } else {
      entry.spans += (row.metadata?.runs ?? []).filter((run) => run.cite).length;
    }

    counts.set(row.note_id, entry);
  }

  return counts;
}

/** The summary chunk of each note, by note id. */
function previews(rows: readonly ChunkQueryRow[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const row of rows) {
    if (row.chunk_type !== "summary" || found.has(row.note_id)) continue;
    const preview = previewOf(row.content);
    if (preview) found.set(row.note_id, preview);
  }
  return found;
}

export async function getDashboardFeed(now: Date): Promise<DashboardFeed> {
  const supabase = await createClient();

  const [{ data: notes, error: noteError }, { data: chunks, error: chunkError }, { data: auth }] =
    await Promise.all([
      supabase
        .from("notes")
        .select("id, title, created_at, processing_status, audio_duration_seconds")
        .order("created_at", { ascending: false })
        .returns<NoteQueryRow[]>(),
      supabase
        .from("note_chunks")
        .select("note_id, chunk_type, content, metadata")
        .in("chunk_type", GENERATED)
        .returns<ChunkQueryRow[]>(),
      // getUser, never getSession: the proxy revalidates the token on every
      // request and this reads the same revalidated identity.
      supabase.auth.getUser(),
    ]);

  if (noteError) throw new Error(`Failed to load notes: ${noteError.message}`);
  if (chunkError) throw new Error(`Failed to load note counts: ${chunkError.message}`);

  const rows = chunks ?? [];
  const preview = previews(rows);

  const inputs: FeedNoteInput[] = (notes ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    processingStatus: row.processing_status,
    durationSeconds: row.audio_duration_seconds,
    preview: preview.get(row.id) ?? null,
  }));

  return {
    email: auth?.user?.email ?? null,
    totalNotes: inputs.length,
    groups: groupNotesByDay(inputs, tally(rows), now),
  };
}
