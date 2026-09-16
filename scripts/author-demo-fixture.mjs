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

/** Decimal places kept on each embedding component. See the comment at the
 *  fixture's `embedding` field for the measurement behind the number. */
const EMBEDDING_DECIMALS = 5;

/** pgvector text form in, pgvector text form out, with the components rounded.
 *  Parsing and re-stringifying is deliberate — the alternative is a regex over
 *  a 1024-element numeric string, which is harder to read and no faster. */
function roundVector(text) {
  if (typeof text !== "string") return text;
  const m = 10 ** EMBEDDING_DECIMALS;
  return JSON.stringify(
    JSON.parse(text).map((x) => Math.round(x * m) / m),
  );
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const audioPath = arg("audio");
const transcriptPath = arg("transcript");
const title = arg("title", "Demo recording");
const out = arg("out", "demo-note-1");
const confirmed = process.argv.includes("--confirm");

if (!confirmed && !audioPath && !transcriptPath) {
  console.error(
    "usage:\n" +
      "  stage 1, from audio : --audio <path> --duration <seconds> --out <name>\n" +
      "  stage 1, from text  : --transcript <path> --out <name>\n" +
      "  stage 2             : --confirm --out <name>\n",
  );
  process.exit(2);
}

/** One state file per note, so authoring a second one cannot silently
 *  overwrite the first one's half-finished state. */
const statePath = () => resolve("scratch", `${out}.state.json`);

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

// ---------------------------------------------------------------------------
// Stage 2 — notegen, embeddings, and the fixture
// ---------------------------------------------------------------------------

if (confirmed) {
  const state = JSON.parse(readFileSync(statePath(), "utf8"));
  console.log(`\nstage 2 for note ${state.noteId}`);

  const { createNotegenPorts } = await import(
    new URL("lib/notegen/notegen-ports.ts", ROOT).href
  );
  const { claimAndGenerate } = await import(
    new URL("lib/notegen/generate-note.ts", ROOT).href
  );
  const { createEmbeddingPorts } = await import(
    new URL("lib/rag/supabase-ports.ts", ROOT).href
  );
  const { embedNoteChunks } = await import(
    new URL("lib/rag/embed-note.ts", ROOT).href
  );

  const { data: noteRow, error: noteReadError } = await owner
    .from("notes")
    .select("id, user_id, raw_transcript, updated_at, notegen_status")
    .eq("id", state.noteId)
    .single();
  if (noteReadError) throw noteReadError;

  // Re-runnable on purpose. notegen_status IS the queue, and a note that has
  // already generated takes a contended zero-row claim rather than generating
  // twice — so re-running this stage to reshape the fixture must not look like
  // a failure, and must not spend a second Gemini call. Skipping on the status
  // is cheaper than claiming and interpreting "contended".
  if (noteRow.notegen_status === null) {
    // The title is nulled ON PURPOSE, and only on the generating run.
    // setTitleIfUnset writes behind `is('title', null)` — the overwrite guard
    // that stops the pipeline renaming a note a human named. Stage 1 set a
    // placeholder from --title, which would otherwise be KEPT and the
    // generated title thrown away.
    //
    // Inside this branch, not above it. It was above it for one run, which
    // nulled the title on a RE-run that then skipped generation and never
    // wrote one back — the fixture came out with title: null. A destructive
    // step guarded by a different condition than the step that repairs it.
    const { error: untitleError } = await owner
      .from("notes")
      .update({ title: null })
      .eq("id", state.noteId);
    if (untitleError) throw untitleError;

    console.log("\ngenerating notes (real Gemini call) ...");
    const notegenPorts = createNotegenPorts(owner, env.GEMINI_API_KEY);
    const outcome2 = await claimAndGenerate(notegenPorts, noteRow);
    console.log(`notegen outcome=${outcome2}`);
    if (outcome2 !== "generated") {
      throw new Error(
        `notegen did not generate (${outcome2}). The claim needs ` +
          `processing_status='completed' AND notegen_status IS NULL.`,
      );
    }
  } else {
    console.log(`\nnotegen already ${noteRow.notegen_status} — skipping, no Gemini call`);
  }

  if (!env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY is missing");
  // embedding IS NULL is the queue at chunk grain, so a second run finds
  // nothing pending and makes no Voyage call. No skip needed here — the
  // pipeline's own queue already says so.
  console.log("\nembedding chunks (real Voyage calls) ...");
  const embedPorts = createEmbeddingPorts(owner, env.VOYAGE_API_KEY);
  const report = await embedNoteChunks(embedPorts, state.noteId);
  console.log(`embed report=${JSON.stringify(report)}`);

  const { data: finalNote, error: finalNoteError } = await owner
    .from("notes")
    .select("title, raw_transcript, notegen_status, audio_duration_seconds, diarization_enabled")
    .eq("id", state.noteId)
    .single();
  if (finalNoteError) throw finalNoteError;

  const { data: finalChunks, error: finalChunkError } = await owner
    .from("note_chunks")
    .select("chunk_type, content, metadata, embedding, persona_id")
    .eq("note_id", state.noteId);
  if (finalChunkError) throw finalChunkError;

  const byType = {};
  let missingEmbedding = 0;
  for (const c of finalChunks ?? []) {
    byType[c.chunk_type] = (byType[c.chunk_type] ?? 0) + 1;
    if (c.embedding === null) missingEmbedding += 1;
  }

  console.log(`\ntitle   : ${finalNote.title}`);
  console.log(`status  : ${finalNote.notegen_status}`);
  console.log(`chunks  : ${JSON.stringify(byType)}`);
  console.log(`unembedded: ${missingEmbedding}`);

  mkdirSync("lib/demo", { recursive: true });
  const fixture = {
    // Authored by this script. Regenerate rather than hand-edit: the
    // embeddings must agree with the content, and no human can keep 1024
    // floats in step with an edited sentence.
    authoredAt: new Date().toISOString().slice(0, 10),
    note: {
      title: finalNote.title,
      rawTranscript: finalNote.raw_transcript,
      audioDurationSeconds: finalNote.audio_duration_seconds,
      diarizationEnabled: finalNote.diarization_enabled,
    },
    chunks: (finalChunks ?? []).map((c) => ({
      chunkType: c.chunk_type,
      content: c.content,
      metadata: c.metadata,
      // pgvector's text form, which is the shape PostgREST wants on the way
      // back in — kept as a string rather than an array for that reason.
      //
      // Rounded to EMBEDDING_DECIMALS places. Voyage returns 9, and the extra
      // four are 31% of this file for no retrieval benefit: MEASURED
      // 2026-09-15 across all 89 vectors, the worst cosine similarity between
      // a rounded vector and its original is 0.999999996. Ranking cannot see
      // that. The file is read at runtime rather than imported, so its size is
      // disk and a little parse time, not bundle — but a megabyte of digits
      // nobody needs is still a megabyte in every clone and every diff.
      embedding: roundVector(c.embedding),
    })),
  };

  const fixturePath = `lib/demo/${out}.json`;
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
  const kb = Math.round(JSON.stringify(fixture).length / 1024);
  console.log(`\nfixture written: ${fixturePath}  (~${kb} KB)`);
  console.log(`\nThe note row and object are still in place. Delete them once`);
  console.log(`the fixture is committed — the fixture is the artefact, not the row.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Stage 1b — from a written transcript, with NO audio
// ---------------------------------------------------------------------------
//
// The demo needs more than one note before "All notes" chat is worth showing,
// and there is only one cleared recording. A note with no audio is a first-
// class state in this app — `notes.audio_storage_path` is nullable and the
// player simply does not render — so these notes are honest rather than
// degraded.
//
// A WRITTEN transcript is acceptable here for exactly the reason it was not
// acceptable for note 1: the objection was that hand-typed timestamps do not
// match the recording, and there is no recording to mismatch. Nothing is
// transcribed, so no Gemini transcription call is made; notegen still runs for
// real in stage 2, so the takeaways are generated rather than invented.
//
// Speakers are mapped to "Speaker N" through the SHIPPED speakerFor, not to the
// names in the source file. Diarization returns opaque cluster ids — the rules
// are explicit that a label is never a name — so a demo showing "Dana" would be
// showing something this app cannot actually produce.

if (transcriptPath) {
  const { speakerFor, formatTimestamp } = await import(
    new URL("lib/transcription/transcript.ts", ROOT).href
  );

  const LINE = /^\[(\d{1,2}):(\d{2})\]\s+([^:]+):\s*(.+)$/;
  const parsed = [];
  for (const raw of readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) throw new Error(`unparseable transcript line: ${line}`);
    parsed.push({
      seconds: Number(m[1]) * 60 + Number(m[2]),
      sourceName: m[3].trim(),
      text: m[4].trim(),
    });
  }
  if (parsed.length === 0) throw new Error("the transcript file is empty");

  // Ordinals by FIRST APPEARANCE, which is what speakerOrdinals does for a real
  // transcription. Numbering by anything else (alphabetical, say) would put
  // Speaker 2 before Speaker 1 in the pane.
  const order = [];
  for (const p of parsed) if (!order.includes(p.sourceName)) order.push(p.sourceName);

  const noteId = randomUUID();
  const lastEnd = parsed[parsed.length - 1].seconds + 6;

  const chunks = parsed.map((p, seq) => {
    const endSeconds = parsed[seq + 1]?.seconds ?? lastEnd;
    const speaker = speakerFor(order.indexOf(p.sourceName) + 1);
    return {
      note_id: noteId,
      user_id: userId,
      chunk_type: "transcript_segment",
      persona_id: null,
      // null puts the chunk on the embedding queue, which stage 2 then drains.
      embedding: null,
      content: p.text,
      metadata: {
        seq,
        ts_start: formatTimestamp(p.seconds),
        ts_end: formatTimestamp(endSeconds),
        ts_start_seconds: p.seconds,
        ts_end_seconds: endSeconds,
        speaker,
      },
    };
  });

  // Matches what persistTranscription writes: the segments joined, no speaker
  // labels and no timestamps. This is what chat feeds the model.
  const rawTranscript = parsed.map((p) => p.text).join(" ");

  const { error: insertError } = await owner.from("notes").insert({
    id: noteId,
    user_id: userId,
    // Left null so stage 2's notegen names it, the same as note 1.
    title: null,
    audio_storage_path: null,
    audio_duration_seconds: lastEnd,
    raw_transcript: rawTranscript,
    // 'completed' is what makes the note eligible for notegen: the claim reads
    // `processing_status = 'completed' AND notegen_status IS NULL`. Nothing is
    // being skipped — there is genuinely no transcription left to do.
    processing_status: "completed",
    diarization_enabled: true,
  });
  if (insertError) throw new Error(`insert failed: ${insertError.message}`);

  const { error: chunkError } = await owner.from("note_chunks").insert(chunks);
  if (chunkError) throw new Error(`chunk insert failed: ${chunkError.message}`);

  mkdirSync("scratch", { recursive: true });
  writeFileSync(
    statePath(),
    JSON.stringify({ noteId, userId, path: null, duration: lastEnd }, null, 2),
  );

  console.log(`\nsource   : ${transcriptPath}`);
  console.log(`note     : ${noteId}`);
  console.log(`segments : ${chunks.length}`);
  console.log(`speakers : ${order.length} (${order.join(", ")} -> Speaker 1..${order.length})`);
  console.log(`duration : ${lastEnd}s`);
  console.log(`audio    : none`);
  console.log(`\nStage 1b done. State written to ${statePath()}`);
  console.log(`Run again with --confirm --out ${out} to generate and embed.`);
  process.exit(0);
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
  statePath(),
  JSON.stringify(
    { noteId, userId, path, title, duration, contentType, segments, rawTranscript: row.raw_transcript },
    null,
    2,
  ),
);

console.log(`\n${"=".repeat(72)}`);
console.log(`Stage 1 done. State written to ${statePath()}`);
console.log(`The note row and the object are LEFT IN PLACE for stage 2.`);
console.log(``);
console.log(`NOTHING IS PUBLIC YET. Read the transcript above. If any of it`);
console.log(`should not be on the internet, say so and this gets thrown away.`);
console.log(`${"=".repeat(72)}`);
