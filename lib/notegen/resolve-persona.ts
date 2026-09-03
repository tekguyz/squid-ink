import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedPersona } from "@/lib/notegen/sweep";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

/** Which persona config a note generates under.
 *
 *  It lived in notegen-ports.ts until 2026-09-02 and moved when per-note
 *  selection gave it a second branch. That file was 227 lines against a
 *  250-line soft ceiling, and "which lens frames this generation" is a
 *  different responsibility from the chunk store and the ports factory — the
 *  same reasoning that split supabase-ports.ts out of the cron route.
 *
 *  THE user_id FILTER IS THE ONE DELIBERATE EXCEPTION to the standing rule
 *  that queries never filter on user_id in application code. That rule exists
 *  because RLS supplies the owner and a redundant filter would mask an RLS
 *  failure instead of exposing it. The cron caller has no RLS to mask:
 *  service_role bypasses it entirely, so an unfiltered lookup would return
 *  whichever account's row Postgres reached first. The Server Action caller
 *  filters identically, where it is defence in depth and one shared query
 *  shape rather than a requirement. */

interface PersonaConfigRow {
  slug: string;
  name: string;
  depth: ResolvedPersona["depth"];
}

/** name and depth feed the prompt; slug keys the lens framing. The uuid is
 *  deliberately NOT read back — nothing downstream has a use for it, and the
 *  chunk rows this pipeline writes always carry persona_id null. */
const CONFIG_COLUMNS = "slug, name, depth";

export async function resolvePersonaFor(
  db: SupabaseClient,
  userId: string,
  personaId: string | null,
): Promise<ResolvedPersona> {
  // 1. The note's own lens, when its owner picked one.
  //
  // Scoped by id AND user_id — the same composite ownership notes_persona_id_
  // fkey enforces, and for the same reason: a foreign key is not subject to
  // RLS, and neither is service_role.
  if (personaId) {
    const { data, error } = await db
      .from("personas")
      .select(CONFIG_COLUMNS)
      .eq("id", personaId)
      .eq("user_id", userId)
      .maybeSingle<PersonaConfigRow>();

    if (error) {
      throw new Error(`resolving the note's persona failed: ${error.message}`);
    }

    if (data) {
      return {
        slug: data.slug,
        name: data.name,
        depth: data.depth,
        source: "note",
      };
    }

    // Zero rows: the lens was deleted between selection and generation. on
    // delete set null normally nulls the column before this can happen, so
    // this is the belt for the window where it has not yet. Falling through is
    // right — refusing to generate over a deleted lens would be worse than
    // generating under the default.
  }

  // 2. Today's path, unchanged. Slug, never name: personas.sql declares and
  // indexes unique (user_id, slug) and states in its own header that slug is
  // the key chosen to survive a reseed, whereas name is display text carrying
  // neither constraint nor index.
  const { data, error } = await db
    .from("personas")
    .select(CONFIG_COLUMNS)
    .eq("user_id", userId)
    .eq("slug", DEFAULT_PERSONA_ID)
    .maybeSingle<PersonaConfigRow>();

  // Thrown, not swallowed into the fallback. "permission denied for table
  // personas" is precisely what a missing service_role grant returns, and
  // falling back would hide that behind output that looks correct — which is
  // how the notes and note_chunks grant gaps stayed invisible until
  // 2026-08-31.
  if (error) throw new Error(`resolving persona failed: ${error.message}`);

  if (data) {
    return {
      slug: data.slug,
      name: data.name,
      depth: data.depth,
      source: "row",
    };
  }

  // 3. Zero rows: an account created before the 2026-08-31 provisioning
  // trigger and deliberately not backfilled. The fallback is a crash floor
  // that keeps generation working for it.
  return {
    slug: DEFAULT_PERSONA_FALLBACK.id,
    name: DEFAULT_PERSONA_FALLBACK.name,
    depth: DEFAULT_PERSONA_FALLBACK.depth,
    source: "fallback",
  };
}
