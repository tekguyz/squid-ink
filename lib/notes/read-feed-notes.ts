import type { createClient } from "@/lib/supabase/server";
import type {
  FeedNoteInput,
  NoteCounts,
} from "@/lib/notes/group-notes-by-day";
import type { ChunkMetadata, ChunkType, ProcessingStatus } from "@/lib/notes/types";
import type { NoteTag } from "@/lib/notes/tags";

/**
 * The two queries behind a list of notes, and the tallying that goes with
 * them.
 *
 * EXTRACTED FROM lib/notes/get-dashboard-feed.ts on 2026-09-09, when the
 * collection detail page became the second screen that renders the feed row.
 * It is one extraction, not a "shared helpers" folder: the dashboard and a
 * collection show the SAME row, so the preview text, the action count and the
 * span count have to come out of the same code or the two screens will
 * eventually disagree about the same note.
 *
 * Neither query filters on user_id. RLS supplies it, and a redundant filter
 * would mask an RLS failure instead of exposing it. The two are issued
 * together because neither depends on the other's result.
 *
 * The counts are the point of the second query. One query grouped in memory,
 * never one query per row: a list of 128 notes would otherwise be 128 round
 * trips.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

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

/** The first sentence-ish of the summary, for the row's second line. */
function previewOf(content: string): string | null {
  const line = content.replace(/\s+/g, " ").trim();
  return line.length === 0 ? null : line;
}

/** Tally per note.
 *
 *  `spans` matches `spansLinked` in lib/notes/note-view-model.ts exactly —
 *  cited summary runs plus every takeaway plus every action item — so the
 *  number on a feed row and the number on the note itself cannot disagree.
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

export interface FeedNotes {
  inputs: FeedNoteInput[];
  counts: Map<string, NoteCounts>;
  /** How many notes match, before the limit. The dashboard prints it in the
   *  footer and it is not the same number as `inputs.length` once a cap
   *  bites. */
  matched: number;
}

/**
 * Read a list of notes, newest first, shaped for groupNotesByDay.
 *
 * `noteIds` null means "every note this user has"; an array narrows to exactly
 * those, and an EMPTY array short-circuits to no queries at all — an empty
 * collection is a real state, and two round trips that provably return nothing
 * are two round trips wasted.
 *
 * `limit` is a bound, not a page size. Nothing here can ask for the next page,
 * and a cursor pager is deliberately not built.
 */
export async function readFeedNotes(
  supabase: Client,
  {
    noteIds,
    limit,
    tagsByNote,
  }: {
    noteIds: string[] | null;
    limit: number;
    tagsByNote: Map<string, NoteTag[]>;
  },
): Promise<FeedNotes> {
  if (noteIds !== null && noteIds.length === 0) {
    return { inputs: [], counts: new Map(), matched: 0 };
  }

  const [
    { data: notes, error: noteError, count },
    { data: chunks, error: chunkError },
  ] = await Promise.all([
    (() => {
      const query = supabase
        .from("notes")
        .select(
          "id, title, created_at, processing_status, audio_duration_seconds",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      return (noteIds === null ? query : query.in("id", noteIds)).returns<
        NoteQueryRow[]
      >();
    })(),
    supabase
      .from("note_chunks")
      .select("note_id, chunk_type, content, metadata")
      .in("chunk_type", GENERATED)
      .returns<ChunkQueryRow[]>(),
  ]);

  if (noteError) throw new Error(`Failed to load notes: ${noteError.message}`);
  if (chunkError)
    throw new Error(`Failed to load note counts: ${chunkError.message}`);

  const rows = chunks ?? [];
  const preview = previews(rows);

  const inputs: FeedNoteInput[] = (notes ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    processingStatus: row.processing_status,
    durationSeconds: row.audio_duration_seconds,
    preview: preview.get(row.id) ?? null,
    tags: tagsByNote.get(row.id) ?? [],
  }));

  return { inputs, counts: tally(rows), matched: count ?? inputs.length };
}
