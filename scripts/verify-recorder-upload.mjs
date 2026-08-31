/**
 * End-to-end proof of the Track 2 write path against the hosted project:
 * a real blob lands at {user_id}/{note_id} in audio-recordings, and a notes row
 * is created pointing at it.
 *
 * Same proof discipline as verify-storage-rls.mjs: the fixture owner signs in
 * for real, the returned JWT is attached to a PUBLISHABLE-key client, and the
 * role claim is checked before any result is trusted. The secret key creates
 * nothing the proof depends on -- it is used only for cleanup, because
 * storage_audio.sql deliberately ships no DELETE policy.
 *
 * The object is NEVER verified with download(). Storage serves reads through a
 * caching CDN and a download() straight after an upsert returns the
 * pre-overwrite body (docs/KNOWN_GAPS.md). Size comes from list() metadata.
 *
 * NOT COVERED HERE: the browser HUD, the cookie plumbing through proxy.ts, and
 * real MediaRecorder capture. Those are the browser pass and the manual
 * protocol. Neither substitutes for the other.
 *
 * Run with: node scripts/verify-recorder-upload.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const AUDIO = "fake opus payload, long enough to have a distinctive length";

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
const noteId = randomUUID();
// The exact shape lib/recorder/upload-audio.ts builds. Two segments, that
// order, no extension -- the first segment IS the RLS check.
const path = `${userId}/${noteId}`;
const blob = new Blob([AUDIO], { type: "audio/webm" });

console.log("proof path : real password-grant JWT via Authorization header");
console.log("             (NOT session cookies through the proxy)");
console.log(`bucket     : ${BUCKET}`);
console.log(`user id    : ${userId}  role=${role}`);
console.log(`note id    : ${noteId}`);
console.log(`object path: ${path}`);
console.log("");

try {
  // --- Upload -----------------------------------------------------------
  console.log("--- upload at {user_id}/{note_id} ---");
  const up = await owner.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "audio/webm;codecs=opus", upsert: true });
  check("upload accepted", !up.error, `error=${JSON.stringify(up.error?.message ?? null)}`);
  check("upload reports the path we asked for", up.data?.path === path, `path=${up.data?.path}`);

  // Size from list() metadata, never download().
  const listing = await owner.storage.from(BUCKET).list(userId, { search: noteId });
  const row = listing.data?.find((o) => o.name === noteId);
  check(
    "object is visible to its owner via list()",
    Boolean(row),
    `rows=${listing.data?.length ?? 0} error=${JSON.stringify(listing.error?.message ?? null)}`,
  );
  check(
    "recorded size matches the bytes uploaded",
    row?.metadata?.size === AUDIO.length,
    `size=${row?.metadata?.size} expected=${AUDIO.length}`,
  );
  console.log("");

  // --- Retry is an upsert -----------------------------------------------
  console.log("--- retry to the same path is an upsert, not a second object ---");
  const again = await owner.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "audio/webm;codecs=opus", upsert: true });
  check("retry accepted", !again.error, `error=${JSON.stringify(again.error?.message ?? null)}`);
  const after = await owner.storage.from(BUCKET).list(userId, { search: noteId });
  check("still exactly one object", (after.data?.length ?? 0) === 1, `rows=${after.data?.length ?? 0}`);
  console.log("");

  // --- The notes row ----------------------------------------------------
  console.log("--- notes row ---");
  const rowValues = {
    id: noteId,
    user_id: userId,
    audio_storage_path: path,
    audio_duration_seconds: 12,
    processing_status: "uploading",
  };
  const ins = await owner.from("notes").upsert(rowValues, { onConflict: "id" });
  check("insert accepted under RLS", !ins.error, `error=${JSON.stringify(ins.error?.message ?? null)}`);

  // The action is an upsert precisely so a repeat write is not a conflict.
  // A plain insert of the same id raises notes_pkey; this proves the
  // difference rather than asserting it.
  const repeat = await owner
    .from("notes")
    .upsert({ ...rowValues, audio_duration_seconds: 13 }, { onConflict: "id" });
  check(
    "second upsert of the same id is NOT a conflict",
    !repeat.error,
    `error=${JSON.stringify(repeat.error?.message ?? null)}`,
  );
  const plain = await owner.from("notes").insert(rowValues);
  check(
    "a plain INSERT of the same id IS a conflict (so upsert is load-bearing)",
    /duplicate key/i.test(plain.error?.message ?? ""),
    `error=${JSON.stringify(plain.error?.message ?? null)}`,
  );

  // No user_id filter -- RLS supplies it, exactly as list-notes.ts does.
  const { data: notes, error: readError } = await owner
    .from("notes")
    .select("id, audio_storage_path, processing_status, audio_duration_seconds")
    .eq("id", noteId);
  check(
    "row reads back, exactly one",
    !readError && notes?.length === 1,
    `rows=${notes?.length} error=${JSON.stringify(readError?.message ?? null)}`,
  );
  check(
    "audio_storage_path points at the object",
    notes?.[0]?.audio_storage_path === path,
    `got=${notes?.[0]?.audio_storage_path}`,
  );
  check(
    "processing_status is uploading, not analyzing",
    notes?.[0]?.processing_status === "uploading",
    `got=${notes?.[0]?.processing_status}`,
  );
  check(
    "the repeat upsert updated in place",
    notes?.[0]?.audio_duration_seconds === 13,
    `got=${notes?.[0]?.audio_duration_seconds} expected=13`,
  );
  console.log("");

  // --- It reaches the feed the / route renders --------------------------
  console.log("--- the note appears in the same query the / list runs ---");
  const feed = await owner
    .from("notes")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });
  check(
    "new note is in the feed",
    Boolean(feed.data?.some((n) => n.id === noteId)),
    `rows=${feed.data?.length ?? 0}`,
  );
  console.log("");
} finally {
  console.log("--- cleanup ---");
  // No DELETE policy exists by design, so object removal is the admin
  // client's job. That is the policy working, not a shortcut around it.
  const { data: removed, error: removeError } = await admin.storage
    .from(BUCKET)
    .remove([path]);
  console.log(
    `  removed ${removed?.length ?? 0} object(s)  error=${JSON.stringify(removeError?.message ?? null)}`,
  );
  // The ROW is deleted as the owner, not as the admin. notes.sql grants
  // public.notes to `authenticated` only -- service_role was never granted
  // anything on it, so the secret key gets "permission denied for table notes"
  // and the probe row would survive. The owner has both the grant and the
  // notes_delete_own policy. This matches scripts/verify-rls.mjs, which deletes
  // its fixture rows the same way.
  //
  // The OBJECT above is the opposite case: storage_audio.sql ships no DELETE
  // policy on purpose, so no authenticated user can remove it and the admin
  // client is the only way. The two cleanups use different clients for real
  // reasons, not by accident.
  const { error: delError } = await owner.from("notes").delete().eq("id", noteId);
  console.log(`  removed note row as owner  error=${JSON.stringify(delError?.message ?? null)}`);

  const { data: rowLeft } = await owner.from("notes").select("id").eq("id", noteId);
  check("no leftover probe row", (rowLeft?.length ?? 0) === 0, `rows=${rowLeft?.length ?? 0}`);

  const { data: leftovers } = await admin.storage.from(BUCKET).list(userId, {
    search: noteId,
  });
  check("no leftover probe object", (leftovers?.length ?? 0) === 0, `leftovers=${leftovers?.length ?? 0}`);
  console.log("");
}

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
