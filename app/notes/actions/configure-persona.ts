"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_QUICK_ACTIONS,
  isPersonaDepth,
  normalizeQuickAction,
} from "@/lib/notes/persona-config";
import type { PersonaDepth } from "@/lib/notes/view-types";

/**
 * Configuring the four provisioned lenses: depth, quick actions, and which
 * lens new notes open on.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason persona.ts,
 * recording.ts and transcription.ts each carry their own.
 *
 * NOT app/notes/actions/persona.ts, and the split is the point. That module
 * answers "which lens does THIS NOTE generate under", and its guard — the
 * processing_status / notegen_status clause — is load-bearing because a note's
 * lens freezes. This module answers "what does that lens DO", which freezes
 * never and carries no such window. Two different questions, two different
 * guards; folding them together would put a lock on writes that must not have
 * one, or drop the lock from writes that must.
 *
 * CONFIGURING, NOT CREATING. No insert and no delete. Custom personas are an
 * Advanced-phase item (docs/ROADMAP.md §8) and a delete surface is blocked on
 * a decision supabase/schemas/note_chunks.sql names: what happens to the
 * takeaways attributed to a deleted lens.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. RLS confines every
 * read and write here to the caller's own rows, so a request naming another
 * account's lens matches zero rows. No application-level user_id filter — that
 * would mask an RLS failure instead of exposing it. `personas` grants
 * service_role SELECT only, deliberately, and nothing here widens that.
 *
 * EDITS APPLY TO NEW NOTES ONLY. docs/DECISIONS.md § Personas rejected
 * regeneration on 2026-08-30, so changing a depth never rewrites a note that
 * has already generated. The rail footer says so on screen.
 */

export type PersonaConfigOutcome =
  /** The write landed. */
  | "written"
  /** The value did not pass validation in this module. A Server Action is a
   *  public HTTP endpoint and the column's check constraint is the floor, not
   *  the guard — a caller must get an outcome it can read, not a Postgres
   *  error string. */
  | "invalid"
  /** Already at MAX_QUICK_ACTIONS. Surfaced in the UI, never silent. */
  | "at-capacity"
  /** That quick action is already on this persona. Rejected rather than
   *  merged: the list renders keyed by its own text. */
  | "duplicate"
  /** The slug resolves to no row this user owns — a zero-persona account
   *  predating the 2026-08-31 provisioning trigger, or another user's slug
   *  that RLS correctly hid. Nothing is written. */
  | "no-persona";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The persona row behind a slug, or null when this user owns no such lens.
 *
 *  It selects quick_actions because that is the only column any caller needs
 *  the VALUE of; setDefaultPersona reads it for the null-or-not answer alone.
 *
 *  No user_id filter: RLS scopes it, and `unique (user_id, slug)` makes the
 *  slug singular within that scope, which is why maybeSingle is honest here. */
async function readPersona(
  supabase: Client,
  slug: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("personas")
    .select("quick_actions")
    .eq("slug", slug)
    .maybeSingle<{ quick_actions: string[] }>();

  if (error) throw new Error(`Failed to read the persona: ${error.message}`);
  return data?.quick_actions ?? null;
}

/** Write one column of one persona, and report whether a row matched.
 *
 *  Zero rows IS the answer — the account has no such lens — not a failure to
 *  retry. Returning the id rather than trusting a count keeps this the same
 *  shape as the guarded write in persona.ts. */
async function writePersona(
  supabase: Client,
  slug: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("personas")
    .update(patch)
    .eq("slug", slug)
    .select("id");

  if (error) throw new Error(`Failed to update the persona: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/**
 * Set a lens's depth.
 *
 * DEPTH IS NOT COSMETIC. lib/notegen/depth-policy.ts maps it onto Gemini's
 * thinking_level and onto a prompt scope, so this control changes what every
 * future note under this lens costs and how much analytical work it contains.
 * That is exactly why the union is checked here, before the database: the
 * column's check constraint would refuse a bad value with an error, and an
 * error is not an answer the screen can render.
 */
export async function setPersonaDepth(
  slug: string,
  depth: PersonaDepth,
): Promise<PersonaConfigOutcome> {
  if (typeof slug !== "string" || slug.length === 0) return "invalid";
  if (!isPersonaDepth(depth)) return "invalid";

  const supabase = await createClient();
  if (!(await writePersona(supabase, slug, { depth }))) return "no-persona";

  revalidatePath("/personas");
  return "written";
}

/**
 * Append a quick action, capped.
 *
 * READ-MODIFY-WRITE, knowingly. quick_actions is a text[] and PostgREST has no
 * array-append; doing this atomically would mean a database function, which is
 * a schema change for one list of strings. The race it leaves is two tabs of
 * ONE account adding at the same instant, where the later write wins and the
 * earlier action is lost — visible immediately on a screen that re-renders
 * from the row it just wrote. That is the whole exposure, and it does not
 * justify the schema.
 *
 * The cap is enforced HERE, not only in the UI. The disabled control at six is
 * UX; this is the enforcement, because a Server Action is a public endpoint.
 */
export async function addQuickAction(
  slug: string,
  action: string,
): Promise<PersonaConfigOutcome> {
  if (typeof slug !== "string" || slug.length === 0) return "invalid";

  const value = normalizeQuickAction(action);
  if (value === null) return "invalid";

  const supabase = await createClient();
  const existing = await readPersona(supabase, slug);
  if (existing === null) return "no-persona";

  if (existing.length >= MAX_QUICK_ACTIONS) return "at-capacity";
  if (existing.includes(value)) return "duplicate";

  const next = [...existing, value];
  if (!(await writePersona(supabase, slug, { quick_actions: next }))) {
    return "no-persona";
  }

  revalidatePath("/personas");
  return "written";
}

/**
 * Remove a quick action, by its stored text.
 *
 * BY TEXT, NOT BY INDEX. An index sent from a client that rendered a stale
 * list removes whatever now sits at that position, which is a silent wrong
 * delete. The text either matches or it does not, and a stale client gets
 * "invalid" instead of removing its neighbour.
 */
export async function removeQuickAction(
  slug: string,
  action: string,
): Promise<PersonaConfigOutcome> {
  if (typeof slug !== "string" || slug.length === 0) return "invalid";

  const value = normalizeQuickAction(action);
  if (value === null) return "invalid";

  const supabase = await createClient();
  const existing = await readPersona(supabase, slug);
  if (existing === null) return "no-persona";

  const remaining = existing.filter((item) => item !== value);
  // Nothing matched: the caller is describing a list this row does not hold.
  if (remaining.length === existing.length) return "invalid";

  if (!(await writePersona(supabase, slug, { quick_actions: remaining }))) {
    return "no-persona";
  }

  revalidatePath("/personas");
  return "written";
}

/**
 * Make this lens the one new notes open on.
 *
 * WRITES THE SLUG THE PREFERENCE ALREADY LIVES AT. seedNotePersona in
 * persona.ts has read `last_persona_id` out of Auth user metadata since
 * 2026-09-02; until now the only thing that wrote it was picking a lens on a
 * note. This makes the same preference settable directly. No column, no table
 * and no partial unique index: one field does not earn a schema addition, and
 * metadata rides the session the user already carries.
 *
 * A SLUG, NEVER A UUID. The uuid is per-user and does not survive a reseed,
 * which is the reason personas.sql chose slug as its key, and the client sees
 * no uuids anywhere in this project.
 *
 * DEFAULT_PERSONA_ID is untouched by this and stays the fixed fallback: the
 * lens an account gets when it has expressed no preference, and the slug
 * lib/notegen/resolve-persona.ts matches at step 2. This preference chooses
 * what a NEW note is seeded with; it does not move the fallback.
 *
 * The row is read first so an unknown slug cannot be parked in metadata, where
 * seedNotePersona would look it up and miss on every note the account creates
 * from then on.
 */
export async function setDefaultPersona(
  slug: string,
): Promise<PersonaConfigOutcome> {
  if (typeof slug !== "string" || slug.length === 0) return "invalid";

  const supabase = await createClient();
  if ((await readPersona(supabase, slug)) === null) return "no-persona";

  const { error } = await supabase.auth.updateUser({
    data: { last_persona_id: slug },
  });
  // THROWN, not swallowed. setNotePersona logs its failure because the note it
  // had already written is the thing the user asked for and the preference is
  // a convenience beside it. Here the preference IS the thing the user asked
  // for, so a silent failure would be a button that reports success and
  // changed nothing.
  if (error) {
    throw new Error(`Failed to set the default lens: ${error.message}`);
  }

  revalidatePath("/personas");
  return "written";
}
