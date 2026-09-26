import { createClient } from "@/lib/supabase/server";
import type { SettingsScreen } from "@/lib/settings/settings-types";

/**
 * Everything /settings renders, read once on the server.
 *
 * Only the signed-in address. No section persists a preference today, so
 * public.user_settings is not read — see lib/settings/settings-types.ts.
 */
export async function getSettingsScreen(): Promise<SettingsScreen> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { email: user?.email ?? null };
}
