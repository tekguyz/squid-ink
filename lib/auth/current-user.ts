import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user for this request, or null.
 *
 * `cache` makes it one auth call per request however many server components
 * ask: app/page.tsx asks twice (the page and its metadata) and app/layout.tsx
 * asks once for the recorder dock
 * (components/recorder/signed-in-dock.tsx).
 *
 * getUser, never getSession: the proxy revalidates the token on every request
 * and this reads the same revalidated identity.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
