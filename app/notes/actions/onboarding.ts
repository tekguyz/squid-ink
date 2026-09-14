"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDED_AT_KEY } from "@/lib/onboarding/onboarding-state";

/**
 * Finishing first-run onboarding, App Surfaces 05.
 *
 * Its own "use server" — the directive is per module, the same reason every
 * sibling file carries one.
 *
 * WRITES ONE FACT: `onboarded_at` in Auth user metadata. Why metadata and not
 * a column is in lib/onboarding/onboarding-state.ts. The default lens the flow
 * also sets is not written here — step 2 calls `setDefaultPersona` from
 * configure-persona.ts, the one existing write path for that preference.
 *
 * `updateUser({ data })` MERGES into the existing metadata, so
 * `last_persona_id` survives this write.
 *
 * Where it goes next is a closed set, never a caller-supplied path: a Server
 * Action is a public HTTP endpoint, and a free-form target would be an open
 * redirect.
 */

export type OnboardingExit = "dashboard" | "connected-apps";

const EXITS: Record<OnboardingExit, string> = {
  dashboard: "/",
  // The same Settings section 06 ships, reached by anchor. Step 3 has no
  // connect action of its own — docs/DECISIONS.md § Onboarding (Surface 05).
  "connected-apps": "/settings#connected-apps",
};

export async function completeOnboarding(exit: OnboardingExit): Promise<"invalid"> {
  if (!Object.hasOwn(EXITS, exit)) return "invalid";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    data: { [ONBOARDED_AT_KEY]: new Date().toISOString() },
  });
  // Thrown. A silent failure would send the account to the dashboard, where
  // the proxy — still reading no flag — sends it straight back here.
  if (error) throw new Error(`Failed to finish onboarding: ${error.message}`);

  redirect(EXITS[exit]);
}
