"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Verifies an emailed confirmation or password-reset link — the POST behind
 * app/auth/confirm's Continue button.
 *
 * A POST, not the GET that opens the page. A mail scanner that fetches every
 * link in a message issues the GET; it does not submit forms. Verifying on the
 * GET would let the scanner spend the one-time token before the person clicks
 * — the failure docs/KNOWN_GAPS.md § "Magic-link tokens are spent by a GET"
 * describes. The cost is one extra click.
 *
 * `token_hash`, not `?code=`. The templates (supabase/templates/) build the
 * link from `{{ .TokenHash }}`, so verifying needs no PKCE verifier cookie and
 * a link opened in a different browser from the one that asked for it still
 * works. `{{ .ConfirmationURL }}` is the shape that did not
 * (docs/DEPLOYMENT.md § Signing in).
 *
 * Only two link types exist in this app. A magic-link `type` is refused:
 * magic-link sign-in is retired.
 */

const DESTINATION = {
  // The proxy's first-run gate sends an account without `onboarded_at` on to
  // /onboarding, and owns that rule.
  email: "/",
  recovery: "/login/new-password",
} as const;

export async function confirmEmailLink(formData: FormData): Promise<void> {
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  if (typeof tokenHash !== "string" || !tokenHash || (type !== "email" && type !== "recovery")) {
    redirect("/login?error=link_invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error(`[auth] link verification failed: ${error.code ?? "(no code)"}`);
    redirect("/login?error=link_invalid");
  }
  redirect(DESTINATION[type]);
}
