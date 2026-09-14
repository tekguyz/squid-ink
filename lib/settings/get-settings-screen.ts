import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_USER_SETTINGS,
  type SettingsScreen,
} from "@/lib/settings/settings-types";

/**
 * Everything /settings renders, read once on the server.
 *
 * No user_id filter: RLS scopes user_settings to the caller, and the table is
 * keyed by user_id, so the only row this can return is the caller's own. A
 * redundant filter would mask an RLS failure instead of exposing it.
 *
 * Zero rows is the ordinary case for an account that has never saved, and it
 * resolves to DEFAULT_USER_SETTINGS rather than to an error.
 */
export async function getSettingsScreen(): Promise<SettingsScreen> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("user_settings")
    .select("require_citations")
    .maybeSingle<{ require_citations: boolean }>();

  if (error) throw new Error(`Failed to read settings: ${error.message}`);

  return {
    email: user?.email ?? null,
    settings: {
      requireCitations:
        data?.require_citations ?? DEFAULT_USER_SETTINGS.requireCitations,
    },
  };
}
