import { cookies } from "next/headers";
import { SESSION_ONLY_COOKIE } from "@/lib/auth/session-persistence";

/** Records "Keep me signed in" for the session a Server Action just created.
 *  Server-only (next/headers); the rule it serves is in session-persistence.ts.
 *
 *  Called only AFTER a sign-in succeeds. Writing it first would let a failed
 *  attempt on /login shorten the session of a user who is already signed in. */
export async function rememberChoice(remember: boolean): Promise<void> {
  const store = await cookies();
  if (remember) {
    store.delete(SESSION_ONLY_COOKIE);
    return;
  }
  // No maxAge and no expires: the marker dies with the browser, as the auth
  // cookies it governs do.
  store.set(SESSION_ONLY_COOKIE, "1", {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
