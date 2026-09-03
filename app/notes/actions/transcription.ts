"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createDeferredClient } from "@/lib/supabase/deferred-client";
import { createClient } from "@/lib/supabase/server";
import { claimAndGenerate } from "@/lib/notegen/generate-note";
import { createNotegenPorts } from "@/lib/notegen/notegen-ports";
import type { GeneratableRow } from "@/lib/notegen/sweep";
import { embedNoteChunks } from "@/lib/rag/embed-note";
import { createEmbeddingPorts } from "@/lib/rag/supabase-ports";
import { createTranscriptionPorts } from "@/lib/transcription/supabase-ports";
import {
  claimNoteForTranscription,
  transcribeClaimedNote,
} from "@/lib/transcription/transcribe-note";
import type { UploadingRow } from "@/lib/transcription/sweep";

/** What the browser learns the moment the claim settles. Deliberately not a
 *  boolean: "we did not start it" has three causes and the button says
 *  something different for each. */
export type TranscriptionTrigger =
  | "started"
  | "not-claimed"
  | "no-audio"
  | "not-found";

/**
 * The user-pressed transcription trigger — the second of the two options
 * docs/KNOWN_GAPS.md § "The cron sweep is the ONLY transcription trigger"
 * left open, and the one the owner chose. There is no automatic call on
 * recording stop, and there is no retry for a 'failed' note.
 *
 * THE SAME CLAIM AS THE CRON. claimNoteForTranscription is the one
 * implementation of `update ... eq(id) ... eq(processing_status,'uploading')`,
 * and the sweep in lib/transcription/sweep.ts calls it too. A zero-row result
 * short-circuits here exactly as it does there, before any download and before
 * any Gemini call — that is a cost guarantee, not a tidiness one.
 *
 * NO AGE CHECK. The sweep's one-hour threshold exists so an unattended
 * reconciliation does not false-fail an upload still in flight. A user pressing
 * a button has already decided the note is ready, so this passes
 * failOnMissingObject: true unconditionally: if the object is not there, the
 * upload is lost and the row goes terminal without spending a call.
 *
 * THE AUTHENTICATED CLIENT, never the secret key. RLS confines the read, the
 * claim and every write to the caller's own rows, so a request for somebody
 * else's note returns zero claimed rows the same way a status mismatch does —
 * no application-level user_id filter, which would mask an RLS failure instead
 * of exposing it. app/api/cron/transcribe/route.ts remains the only shipped
 * file that reads SUPABASE_SECRET_KEY.
 *
 * The claim is awaited; the transcription is not. next/server's `after` runs
 * the callback once the response is finished (stable since Next 15.1; on
 * Vercel it is backed by waitUntil), so the browser is told whether it won the
 * race in milliseconds rather than holding a request open for the whole Gemini
 * pass. That callback gets the Hobby DEFAULT function duration of 300 s, which
 * on that plan is also the hard maximum (docs/DEPLOYMENT.md § Plan limits) —
 * the same ceiling the cron sweep is sized against. It is NOT inherited from
 * the cron route's `maxDuration` export, which governs only that route.
 *
 * NOTE GENERATION CHAINS HERE, added 2026-09-02. Once transcription succeeds
 * the same deferred client — one instance, hoisted, never constructed twice —
 * carries straight into claimAndGenerate. The browser's answer is unchanged:
 * it still learns only whether the transcription claim landed, in
 * milliseconds, and note generation is entirely deferred behind it.
 *
 * EMBEDDINGS CHAIN AFTER THAT, added 2026-09-03, on the same client again.
 * One call, once both chunk kinds exist. It takes no claim: the per-chunk
 * guarded UPDATE in lib/rag/supabase-ports.ts makes a race with the cron sweep
 * cost a duplicate Voyage call and never a duplicate write, and a Voyage call
 * is a rounding error where a Gemini one is not.
 *
 * TWO CLIENTS, ONE IDENTITY. The claim runs on the cookie client, while the
 * request is open and a rotated session can still be written back to the
 * browser. The deferred half runs on a client built from the access token
 * alone (lib/supabase/deferred-client.ts), because a cookie client that
 * refreshes after the response has been sent rotates the user's refresh token
 * into a cookie write that is silently dropped, and signs them out. Same user,
 * same RLS, same publishable key — only the session plumbing differs.
 */
export async function triggerTranscription(
  noteId: string,
): Promise<TranscriptionTrigger> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot transcribe a note: not signed in.");

  // getSession() AFTER getUser(), which is the only ordering that makes this
  // safe: getUser revalidates the token against the auth server and refreshes
  // it if needed, so what getSession reads here is a token that has just been
  // proved good — not the unverified cookie the "never getSession" rule in
  // lib/supabase/session.ts is about. Read before the claim, so a session we
  // cannot carry into after() fails the request instead of stranding a row at
  // 'analyzing'.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Cannot transcribe a note: no access token for the session.");
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error("Cannot transcribe a note: GEMINI_API_KEY is not set.");
  }

  // No .eq("user_id", ...). RLS supplies it; a note owned by somebody else
  // must read as "not found", which is what an RLS-filtered empty result is.
  const { data: row, error } = await supabase
    .from("notes")
    .select("id, user_id, audio_storage_path, audio_duration_seconds, updated_at")
    .eq("id", noteId)
    .maybeSingle<UploadingRow>();

  if (error) throw new Error(`Failed to read the note: ${error.message}`);
  if (!row) return "not-found";

  const ports = createTranscriptionPorts(supabase, geminiKey);

  const outcome = await claimNoteForTranscription(ports, row, {
    failOnMissingObject: true,
  });

  // Both the dashboard pill and the note's own server-rendered status move on
  // a claim, so both caches are stale the moment it lands.
  revalidatePath("/");
  revalidatePath(`/notes/${noteId}`);

  if (outcome === "no-object") return "no-audio";
  if (outcome !== "claimed") return "not-claimed";

  after(async () => {
    // transcribeClaimedNote handles its own failures and writes 'failed'
    // itself, so this catch should never fire. It exists because the response
    // has already been sent: a rejection here is an UNHANDLED one, invisible
    // to the caller and to the browser, and it would leave the row at
    // 'analyzing' for the staleness sweep to fail an hour later with nothing
    // in the log saying why. There is no error column at this scale — the
    // Vercel function log is where a failure is read, so it has to reach it.
    try {
      // ONE deferred client for BOTH phases, built once here. Building it
      // INSIDE the callback is still deliberate: the cookie client above must
      // not be reachable from this point.
      //
      // It was inlined into createTranscriptionPorts before 2026-09-02.
      // Hoisting it is not tidying. A second construction would be a second
      // client that can refresh, and a refresh inside after() rotates the
      // user's refresh token into a cookie write that is silently dropped —
      // the exact bug lib/supabase/deferred-client.ts documents and that was
      // fixed on 2026-09-01. Cookies are not touched again in this block.
      const deferred = createDeferredClient(session.access_token);

      const transcribed = await transcribeClaimedNote(
        createTranscriptionPorts(deferred, geminiKey),
        row,
      );

      // Note generation chains only off a real transcript. A failed
      // transcription leaves processing_status at 'failed', so the note-gen
      // claim's own guard would refuse it anyway — this check only avoids
      // spending an UPDATE to find that out.
      if (transcribed !== "transcribed") return;

      // Re-read rather than reuse `row`: raw_transcript is what transcription
      // just wrote, and the row carried in from above predates it.
      const { data: generatable } = await deferred
        .from("notes")
        .select("id, user_id, raw_transcript, updated_at")
        .eq("id", noteId)
        .maybeSingle<GeneratableRow>();

      if (!generatable) return;

      // The SAME shared function the cron's phase two calls. If both reach
      // this note, the loser takes a contended zero-row claim and spends no
      // Gemini call — no new coordination needed.
      await claimAndGenerate(
        createNotegenPorts(deferred, geminiKey),
        generatable,
      );

      // ---- Embeddings, the third and last deferred phase ------------------
      //
      // ONE call covers BOTH kinds of chunk. By this point transcription has
      // written its transcript_segment rows and note generation has written
      // its summary/takeaway/action_item rows, so "every chunk on this note
      // with no vector" is the complete set. Placing it earlier would embed
      // the transcript and leave the generated chunks to the cron.
      //
      // THE SAME deferred client, never a second one. A second construction
      // would be a second client that can refresh, and a refresh after the
      // response has been sent rotates the user's refresh token into a cookie
      // write that is silently dropped — the bug
      // lib/supabase/deferred-client.ts documents.
      //
      // A missing key SKIPS rather than throws. Embedding is the one phase
      // with a standing backstop: tomorrow's cron sweep is also the backfill,
      // so an unconfigured deployment loses nothing but latency, whereas
      // throwing here would put a red herring in the log for a note that
      // transcribed and generated perfectly well.
      const voyageKey = process.env.VOYAGE_API_KEY;
      if (!voyageKey) {
        console.warn(
          `[embed] note ${noteId}: VOYAGE_API_KEY is not set — leaving the ` +
            `chunks for the cron sweep, which is also the backfill.`,
        );
        return;
      }

      const embedded = await embedNoteChunks(
        createEmbeddingPorts(deferred, voyageKey),
        noteId,
      );
      console.log(`[embed] note ${noteId}: ${JSON.stringify(embedded)}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[transcribe] note ${noteId}: deferred work threw — ${reason}`,
      );
    }
  });

  return "started";
}
