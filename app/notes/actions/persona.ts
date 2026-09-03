"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

/**
 * Which lens a note generates under, chosen on Note Detail before generation.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason recording.ts and
 * transcription.ts each carry their own.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. RLS confines every
 * read and write here to the caller's own rows, so a request for somebody
 * else's note matches zero rows exactly as a frozen note does. No
 * application-level user_id filter — that would mask an RLS failure instead of
 * exposing it, and app/api/cron/transcribe/route.ts stays the only shipped
 * file that reads SUPABASE_SECRET_KEY.
 *
 * NO REGENERATION. docs/DECISIONS.md § Personas rejected it on 2026-08-30, and
 * this module does not reopen it. The guard below is what makes that rejection
 * true by construction rather than merely unimplemented: once generation has
 * been committed to, the lens cannot move.
 */

export type PersonaWriteOutcome =
  /** The guarded UPDATE matched. */
  | "written"
  /** Zero rows: generation has already been committed to, so the lens is
   *  frozen. Not an error — it is the answer. */
  | "locked"
  /** The slug resolves to no row this user owns — the zero-persona account.
   *  Nothing is written, so the existing fallback resolution runs untouched. */
  | "no-persona"
  /** Nobody is signed in. */
  | "not-found";

/** The window in which a lens can still be chosen.
 *
 *  DELIBERATELY WIDER than "notegen_status is null". Pressing Transcribe moves
 *  processing_status to 'analyzing' while notegen_status stays null for the
 *  whole transcription — note generation only claims afterwards, inside the
 *  action's after() block. Locking on notegen_status alone would leave minutes
 *  in which the rail shows one lens and generation could still pick up
 *  another. The premise of this feature is that those are the same lens.
 *
 *  components/note-detail/note-detail-shell.tsx holds the client copy of this
 *  set. That one is UX; this one is enforcement, and they must agree. */
const SELECTABLE_STATUSES = ["local", "uploading"] as const;

type Client = Awaited<ReturnType<typeof createClient>>;

/** The persona_id uuid for a slug this user owns, or null.
 *
 *  No user_id filter: RLS scopes it. Zero rows is not an error — it is the
 *  account created before the 2026-08-31 provisioning trigger and deliberately
 *  not backfilled. */
async function personaIdForSlug(
  supabase: Client,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("personas")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Failed to read the persona: ${error.message}`);
  return data?.id ?? null;
}

/** THE guarded write. One statement, both callers.
 *
 *  The same shape as the note-generation claim, for the same reason: Postgres
 *  row-locks the matched row, so there is no read-then-write window in which
 *  the note could freeze between a check and the write. A zero-row result IS
 *  the answer, not a failure to retry. */
async function writePersona(
  supabase: Client,
  noteId: string,
  personaId: string,
  onlyWhenUnset: boolean,
): Promise<boolean> {
  let query = supabase
    .from("notes")
    .update({ persona_id: personaId })
    .eq("id", noteId)
    .in("processing_status", [...SELECTABLE_STATUSES])
    .is("notegen_status", null);

  // Seeding must never overwrite a real choice — including its own, if two
  // tabs mount against the same note at once.
  if (onlyWhenUnset) query = query.is("persona_id", null);

  const { data, error } = await query.select("id");

  if (error) throw new Error(`Failed to set the note's lens: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/**
 * The user picked a lens.
 *
 * Writes the note, then remembers the choice for their next note. The
 * preference is written ONLY after the note write lands: a refused write must
 * not move the default for every future note.
 */
export async function setNotePersona(
  noteId: string,
  slug: string,
): Promise<PersonaWriteOutcome> {
  const supabase = await createClient();

  const personaId = await personaIdForSlug(supabase, slug);
  if (!personaId) return "no-persona";

  if (!(await writePersona(supabase, noteId, personaId, false))) return "locked";

  // A SLUG, not a uuid — the uuid is per-user and does not survive a reseed,
  // which is the reason personas.sql chose slug as its key.
  //
  // Auth user metadata, not a table. One preference field does not earn a
  // schema addition, and this rides the session the user already carries.
  const { error } = await supabase.auth.updateUser({
    data: { last_persona_id: slug },
  });
  // Logged, not thrown. The note is already correct, and failing the whole
  // action because a convenience did not persist would be the wrong trade.
  if (error) {
    console.error(`[persona] could not remember ${slug}: ${error.message}`);
  }

  revalidatePath(`/notes/${noteId}`);
  return "written";
}

/**
 * Give a note that has none the user's last-used lens, or the default.
 *
 * A REAL WRITE, not a visual default. The rail must never highlight a lens
 * that is not what the database holds, because the whole promise of this
 * feature is that the lens shown is the lens that generated the note.
 *
 * Does NOT write the preference. Seeding is not a decision the user made.
 */
export async function seedNotePersona(
  noteId: string,
): Promise<PersonaWriteOutcome> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not-found";

  const remembered = user.user_metadata?.last_persona_id;
  const slug = typeof remembered === "string" ? remembered : DEFAULT_PERSONA_ID;

  // A remembered lens the user no longer owns falls back to the default rather
  // than failing — a renamed or deleted persona must not strand every new note
  // that account creates from then on.
  const personaId =
    (await personaIdForSlug(supabase, slug)) ??
    (slug === DEFAULT_PERSONA_ID
      ? null
      : await personaIdForSlug(supabase, DEFAULT_PERSONA_ID));

  // Zero personas rows at all. Leave persona_id null so resolvePersonaFor's
  // DEFAULT_PERSONA_FALLBACK branch runs exactly as it does today — that path
  // is live code for accounts predating the provisioning trigger.
  if (!personaId) return "no-persona";

  if (!(await writePersona(supabase, noteId, personaId, true))) return "locked";

  revalidatePath(`/notes/${noteId}`);
  return "written";
}
