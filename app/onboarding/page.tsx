import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { getPersonasScreen } from "@/lib/notes/get-personas-screen";

/**
 * Onboarding, App Surfaces 05. Built 2026-09-14.
 *
 * THREE steps, not the drawing's four. The drawing opens on "Name this
 * workspace", copy from a multi-tenant template; this product is single-owner
 * with no workspace layer (docs/ROADMAP.md §1) and nothing reads a workspace
 * name. The remaining three are renumbered 1–3.
 *
 * Reached only through the proxy's first-run gate (lib/supabase/session.ts):
 * an account without `onboarded_at` is sent here from every page, and an
 * account with it is sent from here to the dashboard.
 *
 * The persona list and current default come from the same loader /personas
 * uses, so the two screens cannot disagree about which lens is the default.
 */
export const metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const { personas, defaultPersonaId } = await getPersonasScreen();
  return <OnboardingShell personas={personas} defaultPersonaId={defaultPersonaId} />;
}
