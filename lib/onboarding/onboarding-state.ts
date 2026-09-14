/**
 * Has this account finished first-run onboarding (App Surfaces 05)?
 *
 * THE FACT LIVES IN AUTH USER METADATA, as `onboarded_at`, beside
 * `last_persona_id`. Decided 2026-09-14, docs/DECISIONS.md § Onboarding:
 *
 *   - The gate runs in the proxy on every matched request, and the proxy
 *     already calls `getUser()` — which revalidates against the auth server
 *     and returns `user_metadata`. Reading the flag there costs no query.
 *     A column on `user_settings` would add a table read to every page load.
 *   - The default lens onboarding step 2 picks is ALREADY metadata
 *     (`last_persona_id`, written by `setDefaultPersona`). Both facts the flow
 *     writes land in one place.
 *   - The user can write their own metadata. That is fine here: the only
 *     thing the flag withholds is a welcome screen, not data.
 *
 * A timestamp rather than `true`, so the value says when as well as whether.
 * Anything that is not a non-empty string reads as "not onboarded".
 *
 * Client-safe: no server imports.
 */

export const ONBOARDING_PATH = "/onboarding";

/** The metadata key. One spelling, read by the proxy and written by the
 *  action. */
export const ONBOARDED_AT_KEY = "onboarded_at";

export function hasOnboarded(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const value = metadata?.[ONBOARDED_AT_KEY];
  return typeof value === "string" && value.length > 0;
}
