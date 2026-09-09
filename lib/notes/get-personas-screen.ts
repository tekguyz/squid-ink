import { createClient } from "@/lib/supabase/server";
import { getPersonas } from "./get-personas";
import { DEFAULT_PERSONA_FALLBACK, DEFAULT_PERSONA_ID } from "./default-persona";
import type { ChunkRow } from "./types";
import type { Persona } from "./view-types";

/**
 * Everything the Personas screen renders.
 *
 * The screen configures lenses; it does not show a note, so it needs the
 * persona rows and one real example — never a fabricated one.
 *
 * `Omit<Persona, "takeaways">` is deliberate and is the same narrowing
 * DEFAULT_PERSONA_FALLBACK already uses. A persona's takeaways are a fact
 * about a NOTE, and this screen has no note; passing an empty array would be a
 * type that type-checks and a claim that is false. The preview below is a
 * separate field for exactly that reason.
 */
export type PersonaConfig = Omit<Persona, "takeaways">;

/** One real takeaway, from the user's most recent note. */
export interface PersonaPreview {
  text: string;
  time: string;
}

export interface PersonasScreen {
  personas: PersonaConfig[];
  /** The note the previews come from. Null when the account has no notes. */
  lastNoteId: string | null;
  lastNoteTitle: string | null;
  /** Keyed by persona SLUG, never a uuid — the client sees no uuids anywhere
   *  in this project. A slug missing from this map has not run on that note,
   *  which the pane renders as a one-line empty state. */
  previews: Record<string, PersonaPreview>;
}

interface LastNoteRow {
  id: string;
  title: string | null;
}

/** Rendered when a note carries no title. The same fallback string
 *  note-view-model.ts uses; `notes.title` is nullable and never stores it. */
const UNTITLED = "Untitled note";

const bySeq = (a: ChunkRow, b: ChunkRow) =>
  (a.metadata.seq ?? 0) - (b.metadata.seq ?? 0);

export async function getPersonasScreen(): Promise<PersonasScreen> {
  const supabase = await createClient();

  // Neither query filters on user_id. RLS supplies it, and a redundant filter
  // would mask an RLS failure rather than expose it.
  const [personaRows, { data: notes, error: noteError }] = await Promise.all([
    getPersonas(),
    supabase
      .from("notes")
      .select("id,title")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<LastNoteRow[]>(),
  ]);

  if (noteError) throw new Error(`Failed to load last note: ${noteError.message}`);

  // Zero rows is a pre-2026-08-31 account that the provisioning trigger never
  // covered, and is deliberately not backfilled. It is not an error, and it is
  // the same crash floor Note Detail renders.
  const personas: PersonaConfig[] =
    personaRows.length === 0
      ? [DEFAULT_PERSONA_FALLBACK]
      : personaRows.map((row) => ({
          id: row.slug,
          name: row.name,
          sub: row.sub,
          depth: row.depth,
          actions: row.quick_actions,
        }));

  const lastNote = notes?.[0] ?? null;
  if (!lastNote) {
    return { personas, lastNoteId: null, lastNoteTitle: null, previews: {} };
  }

  // Sequential, not parallel: the chunk query needs the note id, and this
  // screen issues two round trips rather than fetching every takeaway the
  // account owns to find the newest note's.
  const { data: chunks, error: chunkError } = await supabase
    .from("note_chunks")
    .select("*")
    .eq("note_id", lastNote.id)
    .eq("chunk_type", "takeaway")
    .returns<ChunkRow[]>();

  if (chunkError) {
    throw new Error(`Failed to load preview takeaways: ${chunkError.message}`);
  }

  // A null persona_id means the default persona — the same convention
  // note-view-model.ts follows, and what keeps a chunk written before the
  // personas table existed rendering under Neutral Analyst. Where the account
  // has no row with that slug, the first lens in rail order takes them, rather
  // than the takeaways vanishing.
  const slugById = new Map(personaRows.map((row) => [row.id, row.slug]));
  const defaultSlug =
    personaRows.find((row) => row.slug === DEFAULT_PERSONA_ID)?.slug ??
    personas[0]?.id ??
    DEFAULT_PERSONA_ID;

  const previews: Record<string, PersonaPreview> = {};
  for (const chunk of (chunks ?? []).slice().sort(bySeq)) {
    const slug =
      chunk.persona_id === null
        ? defaultSlug
        : (slugById.get(chunk.persona_id) ?? defaultSlug);
    // First in seq order wins. A lens's first takeaway is the one it led with.
    if (!previews[slug]) previews[slug] = {
      text: chunk.content,
      time: chunk.metadata.ts_start ?? "00:00",
    };
  }

  return {
    personas,
    lastNoteId: lastNote.id,
    lastNoteTitle: lastNote.title ?? UNTITLED,
    previews,
  };
}
