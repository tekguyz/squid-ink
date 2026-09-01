"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createDeferredClient } from "@/lib/supabase/deferred-client";
import { createClient } from "@/lib/supabase/server";
import { createTranscriptionPorts } from "@/lib/transcription/supabase-ports";
import {
  claimNoteForTranscription,
  transcribeClaimedNote,
} from "@/lib/transcription/transcribe-note";
import type { UploadingRow } from "@/lib/transcription/sweep";

/**
 * Creates the notes row for a recording, called as the upload STARTS.
 *
 * processing_status is 'uploading', and this track never writes anything else.
 * 'analyzing' and 'completed' belong to Track 3's transcription pipeline and are
 * explicitly outside this track's scope — writing 'analyzing' here would claim a
 * model pass that nothing performs.
 *
 * Writing the row before the bytes land is possible because the Storage path is
 * deterministic: the note id is generated on the client before capture begins,
 * so {user_id}/{note_id} is known up front and audio_storage_path can be filled
 * in immediately.
 *
 * A failed upload therefore leaves a row at 'uploading' whose object is missing.
 * That is the intended outcome, not a leak: the note is visible in the list, the
 * audio is still in IndexedDB, and a retry upserts the same row and the same
 * object. Whoever builds Track 3 must not assume an 'uploading' row has an
 * object behind it. The same id also makes this action safely retryable — it
 * upserts rather than failing on a duplicate key.
 *
 * Auth is checked here, not assumed. Next.js's own docs are explicit that
 * Server Functions are reachable by direct POST, not just through the UI. The
 * user id is read from the verified session and never taken from the argument;
 * RLS's `with check` on notes_insert_own then validates the value we supply.
 * That is supplying an owner, not filtering by one.
 */
export async function createRecordedNote(input: {
  noteId: string;
  audioStoragePath: string;
  durationSeconds: number;
}): Promise<{ id: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot create a note: not signed in.");

  const { error } = await supabase.from("notes").upsert(
    {
      id: input.noteId,
      user_id: user.id,
      audio_storage_path: input.audioStoragePath,
      // The column is integer; a fractional duration would be silently
      // truncated by Postgres, so truncate deliberately and visibly.
      audio_duration_seconds: Math.floor(input.durationSeconds),
      processing_status: "uploading",
    },
    { onConflict: "id" },
  );

  if (error) throw new Error(`Failed to create note: ${error.message}`);

  revalidatePath("/");
  return { id: input.noteId };
}

/**
 * Tier 1 of the two-tier reconciliation for a failed upload
 * (docs/KNOWN_GAPS.md § Recorder HUD). Called from the recorder's catch block
 * the instant a Storage transfer throws.
 *
 * Tier 2 — the staleness sweep in lib/transcription/sweep.ts — reaches the same
 * row only after an hour, and on the Vercel Hobby daily cron that can be a full
 * day. Nothing about that wait is informative: the client that caused the
 * failure already knows. So this writes 'failed' with no threshold and no
 * retry-then-fail.
 *
 * Tier 2 confirms the object is absent before failing a row; tier 1 has no such
 * evidence — it fires purely on "the client caught an error". That is only safe
 * because the caller's try block is scoped to the Storage transfer itself, and
 * because of the guard below.
 *
 * THE GUARD. `.eq('processing_status', 'uploading')` is the same one-statement
 * atomic claim sweep.ts uses. Postgres row-locks the matched row, so a
 * duplicate call, or a race with a cron invocation that already advanced the
 * row to 'analyzing' or 'completed', matches nothing instead of dragging
 * finished work back to a terminal state. Zero rows matched is not an error
 * here — it means somebody else got there first, which is the correct outcome.
 *
 * The authenticated server client, never the secret key: RLS supplies the owner
 * and the secret key stays confined to app/api/cron/transcribe/route.ts. There
 * is deliberately no `.eq('user_id', ...)` — an application filter would mask
 * an RLS failure instead of exposing it.
 */
export async function markUploadFailed(noteId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot fail a note: not signed in.");

  const { error } = await supabase
    .from("notes")
    .update({ processing_status: "failed" })
    .eq("id", noteId)
    .eq("processing_status", "uploading")
    .select("id");

  if (error) throw new Error(`Failed to mark note as failed: ${error.message}`);

  revalidatePath("/");
}

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
      // Fresh ports on the token client. Building them INSIDE the callback is
      // deliberate: the cookie client above must not be reachable from here.
      await transcribeClaimedNote(
        createTranscriptionPorts(
          createDeferredClient(session.access_token),
          geminiKey,
        ),
        row,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[transcribe] note ${noteId}: deferred transcription threw — ${reason}`,
      );
    }
  });

  return "started";
}
