import { createClient } from "@supabase/supabase-js";
// The Supabase port implementations, shared with the on-demand server action
// in app/notes/actions.ts. They take the client as an argument, which is what
// lets that action pass the authenticated client while this route passes the
// service-role one below.
import { sweepPortsFor } from "@/lib/transcription/supabase-ports";
import { sweep } from "@/lib/transcription/sweep";

/** The Vercel Cron entry point, and the ONE piece of application code that
 *  holds the Supabase secret key.
 *
 *  ------------------------------------------------------------------------
 *  SECRET KEY AMENDMENT. Until this route existed the secret key lived in
 *  exactly one place, scripts/verify-rls.mjs, and docs/DEPLOYMENT.md recorded
 *  that it was "correctly absent" from Vercel. That is no longer true, and the
 *  change is deliberate rather than a leak:
 *
 *    - scripts/verify-rls.mjs            — local only, reads .env.local
 *    - app/api/cron/transcribe/route.ts  — THIS file, server only
 *
 *  Nowhere else, and the 2026-08-31 extraction of the ports into
 *  lib/transcription/supabase-ports.ts did not change that: that module
 *  reads no environment variable and holds no key. It receives whichever
 *  client its caller built. Nowhere else. Never NEXT_PUBLIC_-prefixed. The key is needed because a cron
 *  invocation has no user session and therefore no RLS identity: it must read
 *  and write rows belonging to whichever user recorded them. That is what
 *  bypassing RLS is for, and it is why this route is gated on CRON_SECRET
 *  before it touches anything.
 *  ------------------------------------------------------------------------
 *
 *  maxDuration is 300 because the TEKGUYZ team is on the Vercel Hobby plan,
 *  where 300 s is both the default and the hard ceiling — there is no extended
 *  duration to opt into (measured 2026-08-31). MAX_TRANSCRIPTIONS_PER_RUN is
 *  sized against that number, not against Pro's 800 s. */
export const maxDuration = 300;

/** Vercel sends the CRON_SECRET value as `Authorization: Bearer <value>`
 *  (vercel.com/docs/cron-jobs/manage-cron-jobs § Securing cron jobs).
 *
 *  An unset secret refuses everything. Failing open would leave a route that
 *  spends money on the Gemini API reachable by anyone who guesses the path. */
export function isAuthorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url || !secretKey || !geminiKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !secretKey && "SUPABASE_SECRET_KEY",
      !geminiKey && "GEMINI_API_KEY",
    ].filter(Boolean);

    console.error(`[transcribe] not configured: missing ${missing.join(", ")}`);
    return new Response(`Not configured: missing ${missing.join(", ")}`, {
      status: 500,
    });
  }

  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const report = await sweep(sweepPortsFor(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[transcribe] sweep aborted: ${message}`);
    return new Response(`Sweep failed: ${message}`, { status: 500 });
  }
}
