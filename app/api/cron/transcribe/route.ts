import { createClient } from "@supabase/supabase-js";
import { createTranscriptionPorts } from "@/lib/transcription/supabase-ports";
import { createNotegenPorts } from "@/lib/notegen/notegen-ports";
import { notegenSweep } from "@/lib/notegen/sweep";
// Read-only import. lib/transcription/sweep.ts owns processing_status and is
// not modified by this change; taking the number from there rather than
// redeclaring it is what keeps the two phases on ONE budget.
import { RUN_BUDGET_MS, sweep } from "@/lib/transcription/sweep";
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
import { embeddingSweep, type EmbedSweepReport } from "@/lib/rag/sweep";

/** The Vercel Cron entry point, and the ONE piece of application code that
 *  holds the Supabase secret key.
 *
 *  ------------------------------------------------------------------------
 *  SECRET KEY AMENDMENT. Until this route existed the secret key lived in
 *  exactly one place, scripts/verify-rls.mjs, and docs/DEPLOYMENT.md recorded
 *  that it was "correctly absent" from Vercel. That is no longer true, and the
 *  change is deliberate rather than a leak:
 *
 *    - scripts/*.mjs                     — local only, read .env.local
 *    - app/api/cron/transcribe/route.ts  — THIS file, server only
 *
 *  Nowhere else. Never NEXT_PUBLIC_-prefixed. The key is needed because a cron
 *  invocation has no user session and therefore no RLS identity: it must read
 *  and write rows belonging to whichever user recorded them. That is what
 *  bypassing RLS is for, and it is why this route is gated on CRON_SECRET
 *  before it touches anything.
 *
 *  The manual "Transcribe" Server Action added on 2026-09-01 did NOT widen
 *  this. triggerTranscription in app/notes/actions/transcription.ts runs as the signed-in
 *  user through the cookie client, and RLS confines it to that user's own row.
 *  ------------------------------------------------------------------------
 *
 *  The Supabase implementation of SweepPorts used to live here. It moved to
 *  lib/transcription/supabase-ports.ts on 2026-09-01 so the Server Action
 *  builds its ports — above all its CLAIM — from the same code rather than a
 *  second copy. Nothing about this route's gating or its role as the daily net
 *  changed with that move.
 *
 *  TWO PHASES ON ONE CLOCK, added 2026-09-02. Transcription runs first, then
 *  structured note generation sweeps whatever has reached 'completed' —
 *  including rows this same invocation just transcribed, which is why the
 *  order is not arbitrary. Both phases share ONE startedAt and one
 *  RUN_BUDGET_MS. Phase two is HANDED the remaining budget as a deadline
 *  rather than computing its own, because two 240 s budgets under a 300 s
 *  platform ceiling is a run that gets killed mid-write.
 *
 *  THREE PHASES ON ONE CLOCK, from 2026-09-03. Embedding population sweeps
 *  last, over every chunk in the table that still has no vector, for every
 *  user — which makes this phase the BACKFILL as well as the backstop. It
 *  takes the same startedAt + RUN_BUDGET_MS deadline as phase two rather than
 *  a third budget of its own, and its own MAX_EMBED_NOTES_PER_RUN cap bounds
 *  cost. An unset VOYAGE_API_KEY skips this phase and is reported in the
 *  response body; it does not fail a run whose first two phases succeeded.
 *
 *  The note-gen ports are built from the SAME db client. A second client here
 *  would be a second secret-key read for no reason — this route is still the
 *  only shipped file that reads SUPABASE_SECRET_KEY, and
 *  project-conventions.test.ts fails the build if that stops being true.
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

  // ONE clock for both phases. Read before phase one so the deadline handed
  // to phase two accounts for every millisecond transcription spends.
  const startedAt = Date.now();

  try {
    const report = await sweep(createTranscriptionPorts(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);

    // Phase two, on the remainder of the SAME budget. A run where
    // transcription used the clock claims nothing here and defers instead.
    const notegen = await notegenSweep(createNotegenPorts(db, geminiKey), {
      deadlineAt: startedAt + RUN_BUDGET_MS,
    });
    console.log(`[notegen] ${JSON.stringify(notegen)}`);

    // Phase three, on the remainder of the SAME budget. ONE clock, THREE
    // phases now — the route still reads a single startedAt and every phase is
    // handed the same deadline rather than starting its own. Embedding runs
    // last on purpose: it is the only phase with a standing backstop, since
    // this same sweep is also the backfill, so a busy run deferring it costs
    // nothing but a day.
    const voyageKey = process.env.VOYAGE_API_KEY;
    let embeddings: EmbedSweepReport | { skipped: string } = {
      skipped: "VOYAGE_API_KEY is not set",
    };

    if (voyageKey) {
      // Its OWN boundary, not the route's. An unset key is not the only way
      // this phase can fail — a revoked key is a fatal VoyageError that
      // propagates out of embeddingSweep — and both deserve the same answer,
      // because phases one and two have already committed real work whose
      // report would otherwise be thrown away with a 500.
      try {
        embeddings = await embeddingSweep(createEmbeddingPorts(db, voyageKey), {
          deadlineAt: startedAt + RUN_BUDGET_MS,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[embed] phase failed: ${message}`);
        embeddings = { skipped: message };
      }
    } else {
      // Loud, but not fatal. Same reasoning as the catch above.
      console.error(`[embed] skipped: VOYAGE_API_KEY is not set`);
    }
    console.log(`[embed] ${JSON.stringify(embeddings)}`);

    return Response.json({ ...report, notegen, embeddings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[transcribe] sweep aborted: ${message}`);
    return new Response(`Sweep failed: ${message}`, { status: 500 });
  }
}
