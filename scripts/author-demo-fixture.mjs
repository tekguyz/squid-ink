/**
 * Authors the demo-mode fixture from a real audio clip, using the REAL pipeline.
 *
 * Demo mode seeds each visitor from a checked-in fixture rather than copying
 * rows out of a hidden source account. The fixture's content therefore has to
 * be authored once, and this is the tool that does it — run by a human, not by
 * the app, and not on a schedule.
 *
 * WHY THE REAL PIPELINE, and not a hand-written transcript. A demo whose
 * transcript was typed by hand has timestamps that do not match the audio, so
 * every [[cite:t<seq>]] chip scrolls to the wrong line and the citation feature
 * demonstrates itself being broken. Running Gemini once costs pennies for a
 * clip this short and makes the transcript, the timestamps, the speaker
 * clustering and the citations all agree with what a visitor actually hears.
 *
 * TWO STAGES, on purpose. Stage 1 transcribes and PRINTS, then stops. The clip
 * becomes public the moment the fixture ships, so a human reads the transcript
 * and confirms there is nothing in it that should not be on the internet before
 * anything else happens. Stage 2 (--confirm) is not written yet.
 *
 *     node scripts/author-demo-fixture.mjs --audio <path> --title "..."
 *
 * Imports the SHIPPED transcription functions through the same "@/" resolve
 * hook scripts/verify-manual-transcribe.mjs uses — a copy of the pipeline here
 * would only prove the copy agrees with itself.
 *
 * Rows as the RLS fixture OWNER, objects as that same owner. Deliberately NOT
 * the real account: authoring leaves a note row behind between stages, and it
 * has no business appearing on the owner's own dashboard.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const STATE = "scratch-demo-fixture-state.json";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const audioPath = arg("audio");
const title = arg("title", "Demo recording");
const confirmed = process.argv.includes("--confirm");

if (!audioPath) {
  console.error(
    "usage: node scripts/author-demo-fixture.mjs --audio <path> [--title \"...\"]",
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Loading the shipped TypeScript
// ---------------------------------------------------------------------------

const ROOT = pathToFileURL(resolve(import.meta.dirname, "..") + "/").href;

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
const { claimAndTranscribe } = await import(
  new URL("lib/transcription/transcribe-note.ts", ROOT).href
);
const { resolveAudioMimeType } = await import(
  new URL("lib/audio/mime-type.ts", ROOT).href
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

const env = loadEnv(".env.local");
for (const name of ["GEMINI_API_KEY", "RLS_TEST_OWNER_EMAIL"]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: env.RLS_TEST_OWNER_EMAIL,
  password: env.RLS_TEST_OWNER_PASSWORD,
});
if (signInError) throw signInError;

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;
console.log(`signed in as ${env.RLS_TEST_OWNER_EMAIL}  user=${userId}`);

if (confirmed) {
  console.error(
    "\n--confirm is not implemented yet. Stage 2 (notegen, embeddings, writing\n" +
      "the fixture) is a separate change. Run stage 1 and read the transcript.",
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Stage 1 — upload, transcribe for real, print
// ---------------------------------------------------------------------------

const bytes = readFileSync(audioPath);

// The container is read the same way the cron route and the browser player read
// it, rather than guessed from the extension. Storage download() types every
// Blob application/octet-stream, which Gemini answers 400 to, so the object's
// own contentType is what has to be right at upload time.
const ext = basename(audioPath).split(".").pop()?.toLowerCase();
const guessed = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", wav: "audio/wav" }[ext];
const contentType = resolveAudioMimeType([guessed]);

const noteId = randomUUID();
const path = `${userId}/${noteId}`;

console.log(`\nclip   : ${audioPath}`);
console.log(`bytes  : ${bytes.length.toLocaleString()}`);
console.log(`type   : ${contentType}  (from .${ext})`);
console.log(`note   : ${noteId}`);

// The Blob carries the type as well as the option. MEASURED 2026-09-15: with
// `new Blob([bytes])` and only the contentType option, Storage recorded the
// object as application/octet-stream — and octet-stream is precisely what
// resolveAudioMimeType cannot use, so the pipeline would fall back to
// audio/webm and hand Gemini an MP3 under the wrong container name.
const { error: uploadError } = await owner.storage
  .from(BUCKET)
  .upload(path, new Blob([bytes], { type: contentType }), {
    contentType,
    upsert: true,
  });
if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);
console.log(`\nuploaded to ${path}`);

// list(), never download(), to prove the object arrived — Storage reads are
// CDN-cached and download() proves nothing about presence.
const { data: listed, error: listError } = await owner.storage
  .from(BUCKET)
  .list(userId, { search: noteId });
if (listError) throw new Error(`list failed: ${listError.message}`);
const object = (listed ?? []).find((o) => o.name === noteId);
if (!object) throw new Error("the object is not visible after upload");
console.log(`object visible  size=${object.metadata?.size ?? "?"}  type=${object.metadata?.mimetype ?? "?"}`);

// Duration is the recorder's elapsed clock in the real app. An imported clip
// has no such clock, which is exactly the gap docs/KNOWN_GAPS.md records for
// the unbuilt import path; here it is passed in from ffprobe by the human.
const duration = Number(arg("duration", "0")) || null;

const { error: insertError } = await owner.from("notes").insert({
  id: noteId,
  user_id: userId,
  title,
  audio_storage_path: path,
  audio_duration_seconds: duration,
  processing_status: "uploading",
});
if (insertError) throw new Error(`insert failed: ${insertError.message}`);
console.log(`note row inserted at 'uploading'  duration=${duration ?? "null"}`);

const ports = createTranscriptionPorts(owner, env.GEMINI_API_KEY);

let geminiCalls = 0;
const realTranscribe = ports.transcribe;
ports.transcribe = async (request) => {
  geminiCalls += 1;
  return realTranscribe(request);
};

console.log("\ntranscribing (real Gemini call) ...");
// Positional, and in this order — (ports, row, options). Read from the
// signature in lib/transcription/transcribe-note.ts, not from memory.
const outcome = await claimAndTranscribe(
  ports,
  {
    id: noteId,
    user_id: userId,
    audio_storage_path: path,
    audio_duration_seconds: duration,
    updated_at: new Date().toISOString(),
  },
  { failOnMissingObject: true },
);

console.log(`outcome=${JSON.stringify(outcome)}  geminiCalls=${geminiCalls}`);

const { data: row, error: rowError } = await owner
  .from("notes")
  .select("processing_status, raw_transcript, diarization_enabled")
  .eq("id", noteId)
  .single();
if (rowError) throw rowError;

console.log(`status=${row.processing_status}  diarized=${row.diarization_enabled}`);

if (row.processing_status !== "completed") {
  console.error(
    `\nTranscription did not complete. The note is left at '${row.processing_status}' ` +
      `for inspection; read the reason in this script's output above.`,
  );
  process.exit(1);
}

const { data: chunks, error: chunkError } = await owner
  .from("note_chunks")
  .select("chunk_type, content, metadata")
  .eq("note_id", noteId);
if (chunkError) throw chunkError;

const segments = (chunks ?? [])
  .filter((c) => c.chunk_type === "transcript_segment")
  .map((c) => ({
    seq: c.metadata?.seq ?? 0,
    time: c.metadata?.ts_start ?? "00:00",
    speaker: c.metadata?.speaker?.name ?? "Unknown",
    text: c.content,
  }))
  .sort((a, b) => a.seq - b.seq);

const speakers = [...new Set(segments.map((s) => s.speaker))];

console.log(`\n${"=".repeat(72)}`);
console.log(`TRANSCRIPT — read this before anything ships`);
console.log(`${"=".repeat(72)}`);
console.log(`segments=${segments.length}  speakers=${speakers.length} (${speakers.join(", ")})\n`);

for (const s of segments) {
  console.log(`[${s.time}] ${s.speaker}: ${s.text}`);
}

console.log(`\n${"-".repeat(72)}`);
console.log(`RAW (what chat feeds the model)`);
console.log(`${"-".repeat(72)}`);
console.log(row.raw_transcript ?? "(none)");

mkdirSync("scratch", { recursive: true });
writeFileSync(
  resolve("scratch", STATE),
  JSON.stringify(
    { noteId, userId, path, title, duration, contentType, segments, rawTranscript: row.raw_transcript },
    null,
    2,
  ),
);

console.log(`\n${"=".repeat(72)}`);
console.log(`Stage 1 done. State written to scratch/${STATE}`);
console.log(`The note row and the object are LEFT IN PLACE for stage 2.`);
console.log(``);
console.log(`NOTHING IS PUBLIC YET. Read the transcript above. If any of it`);
console.log(`should not be on the internet, say so and this gets thrown away.`);
console.log(`${"=".repeat(72)}`);
