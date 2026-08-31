/**
 * Live proof of the Track 3 pipeline against the hosted project.
 *
 * Four proofs, each end to end through the REAL route over HTTP -- not a
 * reimplementation of the sweep in this file, which would prove only that the
 * copy agrees with itself:
 *
 *   0. The CRON_SECRET gate.  No header and a wrong header both get 401.
 *   1. Happy path.  A real audio object at {user_id}/{note_id} plus an
 *      'uploading' row reaches 'completed', with raw_transcript and
 *      note_chunks rows behind it.
 *   2. Lost-session orphan.  An 'uploading' row backdated past the hour with NO
 *      object reaches 'failed'.
 *   3. Crashed transcription.  An 'analyzing' row backdated past the hour
 *      reaches 'failed'.
 *
 * Proofs 2 and 3 backdate updated_at on INSERT. That works because
 * notes_set_updated_at is a BEFORE UPDATE trigger -- it does not fire on
 * insert, so an explicit updated_at survives.
 *
 * Audio is synthesised locally with Windows SAPI rather than committed as a
 * fixture, so the transcript assertion is against words we chose. Set
 * TRANSCRIBE_TEST_AUDIO to a .wav path to supply your own instead.
 *
 * The object is NEVER verified with download(). Existence comes from list()
 * metadata -- Storage reads are CDN-cached (docs/KNOWN_GAPS.md).
 *
 * Two clients throughout: rows as the OWNER, objects as the ADMIN.
 *
 * Objects need the admin because storage_audio.sql ships no DELETE policy.
 *
 * Rows are the owner by CHOICE, not by necessity -- service_role gained DML on
 * public.notes in this same track, so an admin write would now succeed. It
 * would also prove nothing: going through the owner exercises the RLS path a
 * real user takes, which is the only version worth asserting on.
 *
 * Needs the dev server running:
 *     npm run dev
 *     node scripts/verify-transcription-pipeline.mjs
 */
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const ROUTE = "http://localhost:3000/api/cron/transcribe";
const SPOKEN = "The quick brown fox jumps over the lazy dog";
const WAV = "scratch-verify-transcription.wav";
const HOUR_MS = 60 * 60 * 1000;

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/** Read the role claim without verifying -- we only need to prove we are NOT
 *  running as service_role. Storage and Postgres do the real verification. */
function roleClaim(jwt) {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
  ).role;
}

let failed = false;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

for (const name of ["CRON_SECRET", "GEMINI_API_KEY", "SUPABASE_SECRET_KEY"]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

// ---------------------------------------------------------------------------
// Audio fixture
// ---------------------------------------------------------------------------

/** Windows SAPI. Real speech beats a sine wave, which transcribes to nothing,
 *  and beats a committed binary, which nobody can regenerate. */
function synthesiseSpeech(outPath) {
  const script =
    `Add-Type -AssemblyName System.Speech; ` +
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.SetOutputToWaveFile('${outPath.replace(/'/g, "''")}'); ` +
    `$s.Speak('${SPOKEN}'); $s.Dispose()`;

  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "pipe",
  });
}

function audioBytes() {
  const supplied = process.env.TRANSCRIBE_TEST_AUDIO;
  if (supplied) return { bytes: readFileSync(supplied), path: null };

  try {
    // SAPI needs an absolute path; a relative one lands in PowerShell's own
    // working directory, not ours.
    synthesiseSpeech(resolve(WAV));
  } catch (error) {
    throw new Error(
      `Could not synthesise speech with Windows SAPI (${error.message}). ` +
        `Set TRANSCRIBE_TEST_AUDIO to the path of a .wav file of someone ` +
        `speaking and re-run.`,
    );
  }

  return { bytes: readFileSync(WAV), path: WAV };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: env.RLS_TEST_OWNER_EMAIL,
  password: env.RLS_TEST_OWNER_PASSWORD,
});
if (signInError) throw signInError;

const token = signIn.session.access_token;
const role = roleClaim(token);
if (role !== "authenticated") {
  throw new Error(
    `refusing to trust a result from role "${role}" -- the proof requires the ` +
      `authenticated role, not service_role or a superuser`,
  );
}

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;

// ---------------------------------------------------------------------------
// Route driver
// ---------------------------------------------------------------------------

async function callRoute(authorization = `Bearer ${env.CRON_SECRET}`) {
  const headers = authorization ? { Authorization: authorization } : {};
  const res = await fetch(ROUTE, { headers });
  return { status: res.status, body: await res.text() };
}

async function noteRow(id) {
  const { data, error } = await owner
    .from("notes")
    .select("id, processing_status, raw_transcript, diarization_enabled")
    .eq("id", id);
  if (error) throw new Error(`reading note ${id}: ${error.message}`);
  return data?.[0] ?? null;
}

/** The route is synchronous -- it finishes the sweep before responding -- so
 *  one call is enough. This re-reads only to prove the DATABASE holds the
 *  result, not just that the route returned a number. */
async function statusOf(id) {
  return (await noteRow(id))?.processing_status ?? "(row gone)";
}

const happyNoteId = randomUUID();
const orphanNoteId = randomUUID();
const crashedNoteId = randomUUID();
const missingObjectNoteId = randomUUID();
let wavPath = null;

try {
  // -------------------------------------------------------------------------
  console.log("\nProof 0 — the CRON_SECRET gate");
  // -------------------------------------------------------------------------
  const noHeader = await callRoute(null);
  check("no Authorization header is refused", noHeader.status === 401, `got=${noHeader.status}`);

  const wrong = await callRoute("Bearer definitely-not-the-secret");
  check("a wrong secret is refused", wrong.status === 401, `got=${wrong.status}`);

  const bare = await callRoute(env.CRON_SECRET);
  check("the secret without 'Bearer ' is refused", bare.status === 401, `got=${bare.status}`);

  // -------------------------------------------------------------------------
  console.log("\nProof 1 — a real recording reaches 'completed'");
  // -------------------------------------------------------------------------
  const audio = audioBytes();
  wavPath = audio.path;
  check("synthesised speech has a plausible size", audio.bytes.length > 10_000, `bytes=${audio.bytes.length}`);

  const happyPath = `${userId}/${happyNoteId}`;
  const { error: uploadError } = await owner.storage
    .from(BUCKET)
    .upload(happyPath, new Blob([audio.bytes]), {
      contentType: "audio/wav",
      upsert: true,
    });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  // list(), never download() -- Storage reads are CDN-cached.
  const { data: listed, error: listError } = await owner.storage
    .from(BUCKET)
    .list(userId, { search: happyNoteId });
  if (listError) throw new Error(`list failed: ${listError.message}`);
  check(
    "the object is visible at {user_id}/{note_id}",
    (listed ?? []).some((o) => o.name === happyNoteId),
    happyPath,
  );

  const { error: insertError } = await owner.from("notes").insert({
    id: happyNoteId,
    user_id: userId,
    audio_storage_path: happyPath,
    audio_duration_seconds: 4,
    processing_status: "uploading",
  });
  if (insertError) throw new Error(`insert failed: ${insertError.message}`);

  // The sweep takes at most MAX_TRANSCRIPTIONS_PER_RUN (3) rows per call,
  // oldest first. If the linked project already holds a backlog of 'uploading'
  // rows with objects behind them, one call would never reach ours and the
  // proof would fail for a reason that has nothing to do with the code. Call
  // until this note moves, bounded so a genuine failure still terminates.
  let run = await callRoute();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await statusOf(happyNoteId)) !== "uploading") break;
    run = await callRoute();
  }

  check("the authorised sweep returns 200", run.status === 200, `got=${run.status}`);
  check(
    "the sweep answers JSON, not the login page",
    // A 200 is not enough. proxy.ts once redirected this path to /login, which
    // answers 200 with HTML -- and Vercel cron does not follow redirects, so
    // that failure was completely silent. Assert on the SHAPE of the body.
    run.body.trimStart().startsWith("{"),
    run.body.slice(0, 120),
  );
  console.log(`        sweep report: ${run.body.slice(0, 200)}`);

  const happy = await noteRow(happyNoteId);
  check("status reaches 'completed'", happy?.processing_status === "completed", `got=${happy?.processing_status}`);
  check("raw_transcript is not empty", (happy?.raw_transcript ?? "").length > 0, `len=${(happy?.raw_transcript ?? "").length}`);
  check(
    "the transcript contains a word we synthesised",
    /fox|dog|quick/i.test(happy?.raw_transcript ?? ""),
    JSON.stringify(happy?.raw_transcript ?? "").slice(0, 120),
  );

  const { data: chunks, error: chunkError } = await owner
    .from("note_chunks")
    .select("id, chunk_type, persona_id, embedding, content, metadata")
    .eq("note_id", happyNoteId);
  if (chunkError) throw new Error(`reading chunks: ${chunkError.message}`);

  // every() on an empty array is true, so each assertion below is guarded by
  // the count. Without that, zero chunks would report five passing checks.
  const rows = chunks ?? [];
  const all = (predicate) => rows.length > 0 && rows.every(predicate);

  check("note_chunks rows exist", rows.length > 0, `count=${rows.length}`);
  check(
    "every chunk is a transcript_segment",
    all((c) => c.chunk_type === "transcript_segment"),
  );
  check("every chunk has embedding null", all((c) => c.embedding === null));
  check("every chunk has persona_id null", all((c) => c.persona_id === null));
  check(
    "chunk metadata carries seq and ts_start",
    all(
      (c) => typeof c.metadata?.seq === "number" && typeof c.metadata?.ts_start === "string",
    ),
    JSON.stringify(rows[0]?.metadata ?? {}).slice(0, 160),
  );
  check(
    "the first speaker is numbered 1, not the label's own digits",
    all((c) => !c.metadata?.speaker || /^Speaker [1-9]/.test(c.metadata.speaker.name)) &&
      rows.some((c) => c.metadata?.speaker?.name === "Speaker 1"),
    rows[0]?.metadata?.speaker?.name ?? "(no speaker)",
  );

  // -------------------------------------------------------------------------
  console.log("\nProof 2 — a stale 'uploading' row with no object reaches 'failed'");
  // -------------------------------------------------------------------------
  const stale = new Date(Date.now() - 2 * HOUR_MS).toISOString();

  // Inserted as the OWNER. An admin insert would also work now that
  // service_role has DML, but writing through RLS is what makes this a proof
  // rather than a setup step.
  //
  // Backdated on INSERT: notes_set_updated_at is BEFORE UPDATE, so it does not
  // fire here and the explicit value survives.
  const { error: orphanError } = await owner.from("notes").insert({
    id: orphanNoteId,
    user_id: userId,
    audio_storage_path: `${userId}/${missingObjectNoteId}`,
    audio_duration_seconds: 30,
    processing_status: "uploading",
    updated_at: stale,
  });
  if (orphanError) throw new Error(`orphan insert failed: ${orphanError.message}`);

  await callRoute();
  check("the orphan is marked 'failed'", (await statusOf(orphanNoteId)) === "failed", `got=${await statusOf(orphanNoteId)}`);

  // -------------------------------------------------------------------------
  console.log("\nProof 3 — a stale 'analyzing' row reaches 'failed'");
  // -------------------------------------------------------------------------
  // Owner again, same reason as Proof 2.
  const { error: crashedError } = await owner.from("notes").insert({
    id: crashedNoteId,
    user_id: userId,
    audio_storage_path: `${userId}/${crashedNoteId}`,
    audio_duration_seconds: 30,
    processing_status: "analyzing",
    updated_at: stale,
  });
  if (crashedError) throw new Error(`crashed insert failed: ${crashedError.message}`);

  await callRoute();
  check("the crashed row is marked 'failed'", (await statusOf(crashedNoteId)) === "failed", `got=${await statusOf(crashedNoteId)}`);
} finally {
  // Cleanup runs even on a failed assertion -- no orphaned test data.
  console.log("\nCleanup");

  for (const id of [happyNoteId, orphanNoteId, crashedNoteId]) {
    // The ROW as the owner, deliberately — see the header.
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.log(`  warn  could not delete note ${id}: ${error.message}`);
  }

  // The OBJECT as the admin: storage_audio.sql ships no DELETE policy.
  const { error: rmError } = await admin.storage
    .from(BUCKET)
    .remove([`${userId}/${happyNoteId}`]);
  if (rmError) console.log(`  warn  could not remove object: ${rmError.message}`);

  if (wavPath && existsSync(wavPath)) unlinkSync(wavPath);
  console.log("  ok    test rows, object and wav removed");
}

console.log(failed ? "\nFAIL" : "\nPASS");
process.exit(failed ? 1 : 0);
