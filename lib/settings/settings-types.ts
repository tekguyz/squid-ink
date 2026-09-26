/**
 * What /settings renders, as the client sees it. Client-safe by design: the
 * settings shell is a client component and must not pull in the server
 * Supabase client — the same split lib/notes/default-persona.ts makes.
 *
 * No per-account preference is read here today. public.user_settings
 * (supabase/schemas/user_settings.sql) is kept as the table the next real
 * preference lands on; its only column, require_citations, was dropped on
 * 2026-09-26 (issue #3) because grounding is always on.
 */
export interface SettingsScreen {
  /** The signed-in address. The only identity on the page — there is no
   *  workspace, org or team string, by decision (ROADMAP §7). */
  email: string | null;
}
