/**
 * The per-account preferences /settings reads and writes, as the client sees
 * them. Client-safe by design: the settings shell is a client component and
 * must not pull in the server Supabase client — the same split
 * lib/notes/default-persona.ts makes.
 *
 * Mirrors supabase/schemas/user_settings.sql. A column that is not here is not
 * a setting this product has.
 */
export interface UserSettings {
  /** Persisted, and NOT YET READ by chat or RAG — grounding is always on
   *  today. See docs/KNOWN_GAPS.md. */
  requireCitations: boolean;
}

/** What an account that has never saved gets. Matches the column defaults, so
 *  a missing row and a fresh row describe the same behaviour. */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  requireCitations: true,
};

export interface SettingsScreen {
  /** The signed-in address. The only identity on the page — there is no
   *  workspace, org or team string, by decision (ROADMAP §7). */
  email: string | null;
  settings: UserSettings;
}
