import type {
  ActionItem,
  CiteRun,
  Note,
  Persona,
  Segment,
  Takeaway,
} from "@/lib/notes/view-types";
import { DEFAULT_PERSONA_FALLBACK, DEFAULT_PERSONA_ID } from "./default-persona";
import { SAMPLE_EXCHANGE } from "./sample-exchange";
import { computeSpeakerStats } from "./speaker-stats";
import { DEFAULT_PLAYHEAD, WAVEFORM } from "./waveform";
import type { ChunkRow, ChunkType, NoteRow, PersonaRow } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Formatted from explicit UTC parts rather than toLocaleDateString, whose
 *  output depends on the runtime's locale — server and client would disagree
 *  and React would report a hydration mismatch. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatDuration(seconds: number | null): string {
  const total = Math.max(0, seconds ?? 0);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "Wed 26 Aug 2026 · 41 min". The client name the mock carried has no column
 *  and is deliberately dropped rather than invented. */
function formatMeta(row: NoteRow): string {
  const date = formatDate(row.created_at);
  if (!row.audio_duration_seconds) return date;
  return `${date} · ${Math.round(row.audio_duration_seconds / 60)} min`;
}

const bySeq = (a: ChunkRow, b: ChunkRow) =>
  (a.metadata.seq ?? 0) - (b.metadata.seq ?? 0) || a.id.localeCompare(b.id);

function partition(chunks: ChunkRow[]): Record<ChunkType, ChunkRow[]> {
  const empty: Record<ChunkType, ChunkRow[]> = {
    summary: [],
    takeaway: [],
    action_item: [],
    transcript_segment: [],
    imported_doc: [],
  };
  for (const chunk of chunks) empty[chunk.chunk_type]?.push(chunk);
  for (const key of Object.keys(empty) as ChunkType[]) empty[key].sort(bySeq);
  return empty;
}

const UNKNOWN_SPEAKER = { name: "Unknown", initials: "??", token: "speaker-1" } as const;

function toSegments(rows: ChunkRow[]): Segment[] {
  return rows.map((row, index) => ({
    id: row.metadata.seq ?? index + 1,
    time: row.metadata.ts_start ?? "00:00",
    speaker: row.metadata.speaker ?? UNKNOWN_SPEAKER,
    text: row.content,
  }));
}

function toTakeaways(rows: ChunkRow[]): Takeaway[] {
  return rows.map((row, index) => ({
    n: row.metadata.n ?? String(index + 1).padStart(2, "0"),
    segmentId: row.metadata.segment_id ?? 0,
    time: row.metadata.ts_start ?? "00:00",
    text: row.content,
  }));
}

/** Group takeaway chunks under the personas that produced them.
 *
 *  A chunk with a null persona_id predates attribution and belongs to the
 *  default persona — that is what keeps a note written before this table
 *  existed rendering exactly as it did. */
function toPersonas(personaRows: PersonaRow[], takeaways: ChunkRow[]): Persona[] {
  if (personaRows.length === 0) {
    return [{ ...DEFAULT_PERSONA_FALLBACK, takeaways: toTakeaways(takeaways) }];
  }

  const byPersonaId = new Map<string, ChunkRow[]>();
  const unattributed: ChunkRow[] = [];
  for (const chunk of takeaways) {
    if (chunk.persona_id === null) unattributed.push(chunk);
    else byPersonaId.set(chunk.persona_id, [...(byPersonaId.get(chunk.persona_id) ?? []), chunk]);
  }

  return personaRows.map((row) => {
    const own = byPersonaId.get(row.id) ?? [];
    const mine = row.slug === DEFAULT_PERSONA_ID ? [...own, ...unattributed] : own;
    return {
      id: row.slug,
      name: row.name,
      sub: row.sub,
      depth: row.depth,
      actions: row.quick_actions,
      takeaways: toTakeaways(mine.sort(bySeq)),
    };
  });
}

function toActionItems(rows: ChunkRow[]): ActionItem[] {
  return rows.map((row) => ({
    text: row.content,
    owner: row.metadata.owner ?? "",
    due: row.metadata.due ?? "",
    time: row.metadata.ts_start ?? "00:00",
    segmentId: row.metadata.segment_id ?? 0,
  }));
}

/** A summary chunk stores its prose in `content` and the citation split in
 *  `metadata.runs`. Fall back to one uncited run so a chunk written without
 *  runs still renders. */
function toSummary(rows: ChunkRow[]): CiteRun[] {
  const summary = rows[0];
  if (!summary) return [];
  return summary.metadata.runs ?? [{ text: summary.content }];
}

function countCitations(summary: CiteRun[], personas: Persona[], actionItems: ActionItem[]): number {
  const inSummary = summary.filter((run) => run.cite).length;
  const inTakeaways = personas.reduce((sum, persona) => sum + persona.takeaways.length, 0);
  return inSummary + inTakeaways + actionItems.length;
}

/** Assemble the view model the frozen Note Detail components consume.
 *
 *  Pure: no I/O, no clock, no randomness — so it is fully testable and safe
 *  to call in a render path. */
export function buildNoteViewModel(
  row: NoteRow,
  chunks: ChunkRow[],
  personaRows: PersonaRow[],
): Note {
  const grouped = partition(chunks);

  const segments = toSegments(grouped.transcript_segment);
  const summary = toSummary(grouped.summary);
  const actionItems = toActionItems(grouped.action_item);

  const personas = toPersonas(personaRows, grouped.takeaway);

  return {
    id: row.id,
    title: row.title ?? "Untitled note",
    meta: formatMeta(row),
    turnCount: segments.length,
    duration: formatDuration(row.audio_duration_seconds),
    playhead: DEFAULT_PLAYHEAD,
    spansLinked: countCitations(summary, personas, actionItems),
    summary,
    actionItems,
    stats: computeSpeakerStats(segments),
    segments,
    personas,
    waveform: WAVEFORM,
    sampleExchange: SAMPLE_EXCHANGE,
  };
}
