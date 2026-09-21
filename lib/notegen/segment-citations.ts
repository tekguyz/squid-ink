import type { ChunkMetadata, ChunkRow } from "@/lib/notes/types";

/** Segment attribution for generated takeaways and action items.
 *
 *  WHY THIS FILE EXISTS. Until 2026-09-16 lib/notegen never wrote segment_id
 *  or ts_start onto a chunk, so lib/notes/note-view-model.ts fell back to
 *  segmentId 0 / "00:00" on every generated takeaway and action item. The chip
 *  rendered, showed 00:00, and scrolled nowhere. docs/KNOWN_GAPS.md carries
 *  the measurement.
 *
 *  THE MODEL PRODUCES AN ATTRIBUTION, NOT A TIMESTAMP. It is shown a numbered
 *  transcript and asked which numbered line supports each claim. That number
 *  is resolved here against this note's real transcript_segment rows, and the
 *  timestamp written onto the chunk is copied from THE SEGMENT'S OWN RECORD.
 *  A time the model invented would be plausible, wrong, and worse than 00:00,
 *  because it would look trustworthy.
 *
 *  A MISS WRITES NOTHING. A label outside this note's range resolves to null
 *  and the chunk is written with neither field, exactly as before. Clamping to
 *  a nearby segment would manufacture a citation nobody made.
 *
 *  The numbering is 1-BASED IN THE PROMPT and is NOT the stored segment id.
 *  transcript_segment rows carry metadata.seq starting at 0, and
 *  note-view-model.ts renders Segment.id from that seq — so label 1 resolves
 *  to seq 0. The two must never be conflated: the label is a position in the
 *  text this call was given, the segment id is what transcript-segment.tsx
 *  puts in data-seg. */

/** One transcript_segment row, reduced to what generation and attribution
 *  need. Built by the store; never constructed from the model's output. */
export interface NotegenSegment {
  /** What note-view-model.ts will render as Segment.id, and therefore what
   *  note-detail-shell.tsx looks for as [data-seg="N"]. */
  segmentId: number;
  /** The segment's own display timestamp, or null when it carries none. */
  tsStart: string | null;
  speaker: string | null;
  text: string;
}

/** The two metadata fields a live citation is made of. ts_start is optional
 *  because a segment row can lack one; segment_id is what makes the chip
 *  scroll, so it is not. */
export interface SegmentCitation {
  segment_id: number;
  ts_start?: string;
}

/** Same ordering note-view-model.ts's partition() applies, so the index a
 *  label lands on here is the index that file would land on too. */
const bySeq = (a: ChunkRow, b: ChunkRow) =>
  (a.metadata.seq ?? 0) - (b.metadata.seq ?? 0) || a.id.localeCompare(b.id);

/** Rows in, segments out — the same `seq ?? index + 1` rule toSegments()
 *  applies, mirrored deliberately. If the two ever disagree, every citation
 *  this pipeline writes points one row off. */
export function segmentsFromChunks(rows: ChunkRow[]): NotegenSegment[] {
  return [...rows].sort(bySeq).map((row, index) => ({
    segmentId: row.metadata.seq ?? index + 1,
    tsStart: row.metadata.ts_start ?? null,
    speaker: row.metadata.speaker?.name ?? null,
    text: row.content,
  }));
}

/** The transcript as the model sees it: one line per segment, each opening
 *  with the 1-based label it is asked to cite back. */
export function numberedTranscript(segments: NotegenSegment[]): string {
  return segments
    .map((segment, index) => {
      const who = segment.speaker ? `${segment.speaker}: ` : "";
      return `[${index + 1}] ${who}${segment.text}`;
    })
    .join("\n");
}

/** A model label to a real citation, or null.
 *
 *  Null for every miss, and the misses are all the same answer on purpose: a
 *  non-integer, a zero (which the prompt asks for when nothing supports the
 *  claim), a label past the end, or a note with no segments at all. */
export function resolveSegmentCitation(
  segments: NotegenSegment[],
  label: number | null,
): SegmentCitation | null {
  if (label === null || !Number.isInteger(label)) return null;
  if (label < 1 || label > segments.length) return null;

  const segment = segments[label - 1];
  const citation: SegmentCitation = { segment_id: segment.segmentId };
  // Copied from the segment's record, never from anything the model said.
  if (segment.tsStart) citation.ts_start = segment.tsStart;
  return citation;
}

/** Merge a resolved citation into a chunk's metadata. Spread rather than
 *  assignment so a miss adds no keys at all — an explicit null would be a
 *  written field, and note-view-model.ts cannot tell "absent" from "null". */
export function withCitation(
  metadata: ChunkMetadata,
  citation: SegmentCitation | null,
): ChunkMetadata {
  return citation ? { ...metadata, ...citation } : metadata;
}
