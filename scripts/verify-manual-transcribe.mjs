/**
 * Live proof of the MANUAL transcription trigger against the hosted project.
 *
 * The thing being proved is the atomic claim, so this script imports the
 * SHIPPED function rather than re-implementing it:
 *
 *     lib/transcription/transcribe-note.ts   claimNoteForTranscription
 *                                            claimAndTranscribe
 *     lib/transcription/supabase-ports.ts    createTranscriptionPorts
 *
 * Node 24 strips TypeScript natively, and the resolve hook below maps this
 * project's "@/" alias onto the repo root, so the import is the real module —
 * a copy in this file would only prove that the copy agrees with itself.
 *
 * ports.transcribe is wrapped in a counter. "No second Gemini call" is
 * therefore MEASURED, not asserted: the counter is read before and after each
 * losing attempt.
 *
 * Two proofs:
 *
 *   1. A fresh 'uploading' row with a real object reaches 'completed' when the
 *      shared function is invoked directly, with a transcript and chunks
 *      behind it.
 *   2. Double-spend is impossible. Two concurrent claims against one fresh row
 *      yield exactly one "claimed"; a third attempt after completion yields
 *      "contended"; the Gemini counter does not move for either loser.
 *
 * Runs against the authenticated (RLS) client throughout, which is what the
 * Server Action uses. It needs NO dev server — it exercises the function the
 * action calls, not the HTTP route.
 *
 *   node scripts/verify-manual-transcribe.mjs
 *
 * The object is NEVER verified with download(). Existence comes from list()
 * metadata — Storage reads are CDN-cached.
 *
 * Two clients throughout: rows as the OWNER, objects as the ADMIN, for the
 * same reasons scripts/verify-transcription-pipeline.mjs gives.
 */
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const SPOKEN = "The quick brown fox jumps over the lazy dog";
const WAV = "scratch-verify-manual-transcribe.wav";

// ---------------------------------------------------------------------------
// Loading the shipped TypeScript
// ---------------------------------------------------------------------------

const ROOT = pathToFileURL(resolve(import.meta.dirname, "..") + "/").href;

// A resolve hook is the whole trick: tsconfig's "@/*" paths mean nothing to
// Node, so map them here. Written to a data: URL so this stays one file.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        return next(new URL(specifier.slice(2) + ".ts", ${JSON.stringify(ROOT)}).href, context);
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const { createTranscriptionPorts } = await import(
  new URL("lib/transcription/supabase-ports.ts", ROOT).href
);
const { claimAndTranscribe, claimNoteForTranscription } = await import(
  new URL("lib/transcription/transcribe-note.ts", ROOT).href
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

/** Read the role claim without verifying — we only need to prove we are NOT
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

for (const name of ["GEMINI_API_KEY", "SUPABASE_SECRET_KEY"]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

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
    `refusing to trust a result from role "${role}" — the manual trigger runs ` +
      `as the signed-in user, so the proof requires the authenticated role`,
  );
}

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;

// ---------------------------------------------------------------------------
// The ports, with the Gemini call counted
// ---------------------------------------------------------------------------

const ports = createTranscriptionPorts(owner, env.GEMINI_API_KEY);

let geminiCalls = 0;
const realTranscribe = ports.transcribe;
ports.transcribe = async (request) => {
  geminiCalls += 1;
  return realTranscribe(request);
};

async function noteRow(id) {
  const { data, error } = await owner
    .from("notes")
    .select("id, processing_status, raw_transcript")
    .eq("id", id);
  if (error) throw new Error(`reading note ${id}: ${error.message}`);
  return data?.[0] ?? null;
}

async function statusOf(id) {
  return (await noteRow(id))?.processing_status ?? "(row gone)";
}

async function seed(noteId, bytes) {
  const path = `${userId}/${noteId}`;

  const { error: uploadError } = await owner.storage
    .from(BUCKET)
    .upload(path, new Blob([bytes]), { contentType: "audio/wav", upsert: true });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  const { error: insertError } = await owner.from("notes").insert({
    id: noteId,
    user_id: userId,
    audio_storage_path: path,
    audio_duration_seconds: 4,
    processing_status: "uploading",
  });
  if (insertError) throw new Error(`insert failed: ${insertError.message}`);

  return {
    id: noteId,
    user_id: userId,
    audio_storage_path: path,
    audio_duration_seconds: 4,
    updated_at: new Date().toISOString(),
  };
}

const happyNoteId = randomUUID();
const raceNoteId = randomUUID();
let wavPath = null;

try {
  const audio = audioBytes();
  wavPath = audio.path;

  // -------------------------------------------------------------------------
  console.log("\nProof 1 — the shared function takes an 'uploading' row to 'completed'");
  // -------------------------------------------------------------------------
  const happyRow = await seed(happyNoteId, audio.bytes);

  // list(), never download(). Storage reads are CDN-cached.
  const { data: listed, error: listError } = await owner.storage
    .from(BUCKET)
    .list(userId, { search: happyNoteId });
  if (listError) throw new Error(`list failed: ${listError.message}`);
  check(
    "the object is visible at {user_id}/{note_id}",
    (listed ?? []).some((o) => o.name === happyNoteId),
    happyRow.audio_storage_path,
  );

  // failOnMissingObject: true and NO ageMs — exactly what the Server Action
  // passes. There is no staleness gate on this path.
  const outcome = await claimAndTranscribe(ports, happyRow, {
    failOnMissingObject: true,
  });

  check("claimAndTranscribe reports 'transcribed'", outcome === "transcribed", `got=${outcome}`);
  check("exactly one Gemini call was made", geminiCalls === 1, `calls=${geminiCalls}`);

  const happy = await noteRow(happyNoteId);
  check("status reaches 'completed'", happy?.processing_status === "completed", `got=${happy?.processing_status}`);
  check(
    "the transcript contains a word we synthesised",
    /fox|dog|quick/i.test(happy?.raw_transcript ?? ""),
    JSON.stringify(happy?.raw_transcript ?? "").slice(0, 120),
  );

  const { data: chunks, error: chunkError } = await owner
    .from("note_chunks")
    .select("id")
    .eq("note_id", happyNoteId);
  if (chunkError) throw new Error(`reading chunks: ${chunkError.message}`);
  check("note_chunks rows exist", (chunks ?? []).length > 0, `count=${(chunks ?? []).length}`);

  // -------------------------------------------------------------------------
  console.log("\nProof 2a — a second press on a finished note claims nothing");
  // -------------------------------------------------------------------------
  const before2a = geminiCalls;
  const again = await claimAndTranscribe(ports, happyRow, {
    failOnMissingObject: true,
  });

  check("the repeat attempt reports 'contended'", again === "contended", `got=${again}`);
  check(
    "the Gemini counter did not move",
    geminiCalls === before2a,
    `before=${before2a} after=${geminiCalls}`,
  );
  check("the note is still 'completed'", (await statusOf(happyNoteId)) === "completed");

  // -------------------------------------------------------------------------
  console.log("\nProof 2b — two CONCURRENT claims, one row, one winner");
  // -------------------------------------------------------------------------
  // The real double-spend risk is not a repeat press, it is the cron sweep and
  // the button reaching for the same row in the same second. Both go through
  // this one function, so firing it twice with no await between is the honest
  // reproduction: Postgres row-locks the matched row, the loser re-evaluates
  // the WHERE after the lock releases, and matches nothing.
  const raceRow = await seed(raceNoteId, audio.bytes);
  const before2b = geminiCalls;

  const outcomes = await Promise.all([
    claimNoteForTranscription(ports, raceRow, { failOnMissingObject: true }),
    claimNoteForTranscription(ports, raceRow, { failOnMissingObject: true }),
  ]);

  console.log(`        outcomes: ${JSON.stringify(outcomes)}`);
  check(
    "exactly one caller claimed the row",
    outcomes.filter((o) => o === "claimed").length === 1,
    JSON.stringify(outcomes),
  );
  check(
    "the other was told 'contended'",
    outcomes.filter((o) => o === "contended").length === 1,
    JSON.stringify(outcomes),
  );
  check(
    "NO Gemini call was made by the claim step at all",
    geminiCalls === before2b,
    `before=${before2b} after=${geminiCalls}`,
  );
  check("the row is now 'analyzing'", (await statusOf(raceNoteId)) === "analyzing");

  // -------------------------------------------------------------------------
  console.log("\nProof 2c — the loser cannot transcribe by trying again");
  // -------------------------------------------------------------------------
  const before2c = geminiCalls;
  const loser = await claimAndTranscribe(ports, raceRow, {
    failOnMissingObject: true,
  });

  check("a third attempt reports 'contended'", loser === "contended", `got=${loser}`);
  check(
    "the Gemini counter still did not move",
    geminiCalls === before2c,
    `before=${before2c} after=${geminiCalls}`,
  );
} finally {
  console.log("\nCleanup");

  for (const id of [happyNoteId, raceNoteId]) {
    // The ROW as the owner: it exercises the RLS path a real user takes.
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.log(`  warn  could not delete note ${id}: ${error.message}`);
  }

  // The OBJECT as the admin: storage_audio.sql ships no DELETE policy.
  const { error: rmError } = await admin.storage
    .from(BUCKET)
    .remove([`${userId}/${happyNoteId}`, `${userId}/${raceNoteId}`]);
  if (rmError) console.log(`  warn  could not remove objects: ${rmError.message}`);

  if (wavPath && existsSync(wavPath)) unlinkSync(wavPath);
  console.log("  ok    test rows, objects and wav removed");
}

console.log(failed ? "\nFAIL" : "\nPASS");
process.exit(failed ? 1 : 0);
