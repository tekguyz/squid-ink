/**
 * Loads the three demo notes into the DEMO OWNER account (issue #19,
 * docs/adr/0001-demo-visitors-read-one-shared-demo-owner.md).
 *
 * Every demo visitor reads these rows through the widened select policies;
 * nothing is copied per visitor. This script is the only thing that writes
 * them, and it is run by a human, once, and again only to rebuild the demo:
 *
 *     node scripts/load-demo-owner.mjs
 *
 * RE-RUNNABLE. It creates the account if it is missing, then deletes the demo
 * owner's notes (their chunks, and any visitor chat on them, go by cascade)
 * and inserts them again from lib/demo/ under the same fixed ids, so a note's
 * URL survives a rebuild. The recording is uploaded with upsert.
 *
 * THE ACCOUNT. Its id is not written here: it is read out of
 * public.demo_owner_id() in supabase/schemas/notes.sql, the one place it is
 * named. Nobody signs in as it. Its password is random, generated per run and
 * never printed or stored — the admin API is how the account is maintained.
 * Created confirmed and onboarded, like any finished account. The persona
 * provisioning trigger gives it the four default personas, which are the ones
 * the demo notes were generated under.
 *
 * SECRET KEY, from the gitignored .env.local. Local-only: listed with the
 * other scripts in CLAUDE.md § Keys, which scripts/check-docs.mjs parses.
 * service_role holds select/insert/update/delete on notes and note_chunks and
 * select on personas, which is exactly what this needs.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const DEMO_OWNER_EMAIL = "demo-owner@squid-ink.test";

/** Fixed per note, so /notes/<id> is the same address after a rebuild. The
 *  8001 group sets them apart from the owner id's 8000. */
const NOTES = [
  { file: "demo-note-1", id: "de300000-0000-4000-8001-000000000001", audio: "demo-note-1.mp3", hoursAgo: 50 },
  { file: "demo-note-2", id: "de300000-0000-4000-8001-000000000002", audio: null, hoursAgo: 27 },
  { file: "demo-note-3", id: "de300000-0000-4000-8001-000000000003", audio: null, hoursAgo: 4 },
];

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

/** The id, read from the schema file that defines it. */
function demoOwnerId() {
  const sql = readFileSync("supabase/schemas/notes.sql", "utf8");
  const m = /function public\.demo_owner_id\(\)[\s\S]*?select '([0-9a-f-]{36})'::uuid/.exec(sql);
  if (!m) throw new Error("public.demo_owner_id() not found in supabase/schemas/notes.sql");
  return m[1];
}

const env = loadEnv(".env.local");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ownerId = demoOwnerId();

// ---------------------------------------------------------------- account
const existing = await admin.auth.admin.getUserById(ownerId);
if (existing.data?.user) {
  console.log(`demo owner : ${ownerId}  exists`);
} else {
  const created = await admin.auth.admin.createUser({
    id: ownerId,
    email: DEMO_OWNER_EMAIL,
    // Lower, upper, digit and symbol: the hosted project demands all four.
    password: `${randomBytes(24).toString("base64url")}-Aa1`,
    email_confirm: true,
    user_metadata: { onboarded_at: new Date().toISOString() },
  });
  if (created.error) throw new Error(`could not create the demo owner: ${created.error.message}`);
  console.log(`demo owner : ${ownerId}  created`);
}

// ---------------------------------------------------------------- personas
const { data: personas, error: personaError } = await admin
  .from("personas")
  .select("id, slug")
  .eq("user_id", ownerId);
if (personaError) throw new Error(`persona read failed: ${personaError.message}`);
const neutral = personas.find((p) => p.slug === "neutral-analyst");
if (personas.length !== 4 || !neutral) {
  throw new Error(
    `the demo owner has ${personas.length} personas; the provisioning trigger should have made 4`,
  );
}
console.log(`personas   : ${personas.map((p) => p.slug).join(", ")}`);

// ---------------------------------------------------------------- notes
// service_role bypasses RLS, so this filter on user_id is the whole scope of
// the delete. It is the cron path's exception (data-layer.md), for the same
// reason.
const { error: deleteError } = await admin.from("notes").delete().eq("user_id", ownerId);
if (deleteError) throw new Error(`clearing the old demo notes failed: ${deleteError.message}`);

for (const spec of NOTES) {
  const fixture = JSON.parse(readFileSync(`lib/demo/${spec.file}.json`, "utf8"));
  let audioPath = null;

  if (spec.audio) {
    audioPath = `${ownerId}/${spec.id}`;
    const bytes = readFileSync(`lib/demo/${spec.audio}`);
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(audioPath, new Blob([bytes], { type: "audio/mpeg" }), {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (error) throw new Error(`upload of ${spec.audio} failed: ${error.message}`);
  }

  // Backdated by whole hours so the dashboard shows a used app across more than
  // one day. The order is the thread's order: note 1 happened first.
  const createdAt = new Date(Date.now() - spec.hoursAgo * 3_600_000).toISOString();

  const { error: noteError } = await admin.from("notes").insert({
    id: spec.id,
    user_id: ownerId,
    title: fixture.note.title,
    raw_transcript: fixture.note.rawTranscript,
    audio_duration_seconds: fixture.note.audioDurationSeconds,
    diarization_enabled: fixture.note.diarizationEnabled,
    audio_storage_path: audioPath,
    processing_status: "completed",
    notegen_status: "completed",
    persona_id: neutral.id,
    created_at: createdAt,
  });
  if (noteError) throw new Error(`${spec.file}: note insert failed: ${noteError.message}`);

  const chunks = fixture.chunks.map((c) => ({
    note_id: spec.id,
    user_id: ownerId,
    chunk_type: c.chunkType,
    content: c.content,
    metadata: c.metadata,
    embedding: c.embedding,
    // Null means the default persona, Neutral Analyst, which generated them.
    persona_id: null,
  }));
  const { error: chunkError } = await admin.from("note_chunks").insert(chunks);
  if (chunkError) throw new Error(`${spec.file}: chunk insert failed: ${chunkError.message}`);

  const embedded = chunks.filter((c) => c.embedding).length;
  console.log(
    `note       : ${spec.id}  ${chunks.length} chunks (${embedded} embedded)` +
      `${audioPath ? "  + audio" : ""}  "${fixture.note.title}"`,
  );
}

console.log("\nDone. Prove the read rule with: node scripts/verify-demo-rls.mjs");
