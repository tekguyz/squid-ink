/**
 * Proves demo mode's read rule is exactly as wide as ADR 0001 says, and no
 * wider (issue #19). Live, against the hosted project, with real sessions.
 *
 *     node scripts/verify-demo-rls.mjs
 *
 * Needs .env.local (URL, publishable key, secret key, the RLS test owner) and
 * SUPABASE_ACCESS_TOKEN (set in .claude/settings.local.json) for the cleanup
 * proof, which has to backdate an auth row — nothing else can. Run
 * scripts/load-demo-owner.mjs first.
 *
 * SESSIONS ARE REAL. Visitors come from signInAnonymously with the
 * publishable key, the same call the demo button makes; the real account signs
 * in with a password. Every token's role claim is decoded and must read
 * "authenticated" before a result is trusted — a service_role client bypasses
 * RLS and would pass every assertion while proving nothing. The secret key is
 * used only to create, inspect and delete test identities.
 *
 * Everything this creates is deleted in `finally`, on failure too: two
 * visitors, one backdated visitor, one backdated real account, one probe note.
 * Each visit counts against the hosted anonymous sign-in rate limit.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

function roleClaim(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).role;
}

function demoOwnerId() {
  const sql = readFileSync("supabase/schemas/notes.sql", "utf8");
  const m = /function public\.demo_owner_id\(\)[\s\S]*?select '([0-9a-f-]{36})'::uuid/.exec(sql);
  if (!m) throw new Error("public.demo_owner_id() not found in supabase/schemas/notes.sql");
  return m[1];
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const projectRef = new URL(url).hostname.split(".")[0];
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const ownerId = demoOwnerId();
const BUCKET = "audio-recordings";
const NO_SESSION = { persistSession: false, autoRefreshToken: false };

const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: NO_SESSION });

function asUser(token) {
  const role = roleClaim(token);
  if (role !== "authenticated") {
    throw new Error(`refusing a result from role "${role}"; the proof needs authenticated`);
  }
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: NO_SESSION,
  });
}

async function newVisitor() {
  const pub = createClient(url, publishableKey, { auth: NO_SESSION });
  const { data, error } = await pub.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  created.push(data.user.id);
  return { id: data.user.id, client: asUser(data.session.access_token) };
}

/** SQL through the management API: the one way to backdate auth.users and to
 *  run a function whose EXECUTE is revoked from every API role. */
async function managementQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`management query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

const created = [];
let probeNoteId = null;
let owner = null;

try {
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is not set (see .claude/settings.local.json)");

  const { data: demoNotes } = await admin.from("notes").select("id, audio_storage_path").eq("user_id", ownerId);
  if (!demoNotes?.length) throw new Error("the demo owner has no notes: run scripts/load-demo-owner.mjs");
  const demoIds = demoNotes.map((n) => n.id);
  const audioPath = demoNotes.find((n) => n.audio_storage_path)?.audio_storage_path;
  const { count: demoChunkCount } = await admin
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId);

  // The real account, and one real note of theirs for a visitor to fail to see.
  const pub = createClient(url, publishableKey, { auth: NO_SESSION });
  const signedIn = await pub.auth.signInWithPassword({
    email: env.RLS_TEST_OWNER_EMAIL,
    password: env.RLS_TEST_OWNER_PASSWORD,
  });
  if (signedIn.error) throw new Error(`real account sign-in failed: ${signedIn.error.message}`);
  owner = { id: signedIn.data.user.id, client: asUser(signedIn.data.session.access_token) };
  probeNoteId = crypto.randomUUID();
  const probe = await owner.client
    .from("notes")
    .insert({ id: probeNoteId, user_id: owner.id, title: "demo RLS probe - real note" });
  if (probe.error) throw new Error(`probe note insert failed: ${probe.error.message}`);

  const visitor = await newVisitor();
  const other = await newVisitor();
  console.log(`demo owner : ${ownerId}  ${demoIds.length} notes, ${demoChunkCount} chunks`);
  console.log(`visitor    : ${visitor.id}  (anonymous, role=authenticated)`);
  console.log(`real       : ${owner.id}  ${env.RLS_TEST_OWNER_EMAIL}\n`);

  // ------------------------------------------------------------ reads
  console.log("--- a visitor reads the demo, and only the demo ---");
  const vNotes = await visitor.client.from("notes").select("id, user_id");
  check(
    "reads every demo note",
    !vNotes.error && demoIds.every((id) => vNotes.data.some((n) => n.id === id)),
    `${vNotes.data?.length ?? 0} rows`,
  );
  check("every note it reads is the demo owner's", vNotes.data?.every((n) => n.user_id === ownerId));

  const vChunks = await visitor.client.from("note_chunks").select("id", { count: "exact", head: true });
  check("reads every demo chunk", vChunks.count === demoChunkCount, `${vChunks.count} of ${demoChunkCount}`);

  const vPersonas = await visitor.client.from("personas").select("slug, user_id");
  check(
    "reads the demo owner's four personas",
    vPersonas.data?.length === 4 && vPersonas.data.every((p) => p.user_id === ownerId),
    `${vPersonas.data?.length ?? 0} rows`,
  );

  const vAudio = await visitor.client.storage.from(BUCKET).download(audioPath);
  check("downloads note 1's recording", !vAudio.error && (vAudio.data?.size ?? 0) > 0, `${vAudio.data?.size ?? 0} bytes`);

  const vProbe = await visitor.client.from("notes").select("id").eq("id", probeNoteId);
  check(
    "reads none of a real account's notes (empty, not an error)",
    !vProbe.error && vProbe.data.length === 0,
    vProbe.error?.message ?? `${vProbe.data.length} rows`,
  );

  // ------------------------------------------------------------ writes
  console.log("\n--- a visitor changes nothing ---");
  const insNote = await visitor.client.from("notes").insert({ user_id: ownerId, title: "x" });
  check("cannot insert a note as the demo owner", !!insNote.error);
  const insOwnNote = await visitor.client.from("notes").insert({ user_id: visitor.id, title: "x" });
  check("cannot insert a note of its own", !!insOwnNote.error);
  const updNote = await visitor.client.from("notes").update({ title: "defaced" }).eq("id", demoIds[0]).select("id");
  check("cannot update a demo note", (updNote.data?.length ?? 0) === 0);
  const delNote = await visitor.client.from("notes").delete().eq("id", demoIds[0]).select("id");
  check("cannot delete a demo note", (delNote.data?.length ?? 0) === 0);

  const updChunk = await visitor.client.from("note_chunks").update({ content: "defaced" }).eq("note_id", demoIds[0]).select("id");
  check("cannot update a demo chunk", (updChunk.data?.length ?? 0) === 0);
  const delChunk = await visitor.client.from("note_chunks").delete().eq("note_id", demoIds[0]).select("id");
  check("cannot delete a demo chunk", (delChunk.data?.length ?? 0) === 0);
  const insChunk = await visitor.client
    .from("note_chunks")
    .insert({ note_id: demoIds[0], user_id: ownerId, chunk_type: "summary", content: "x" });
  check("cannot insert a chunk on a demo note", !!insChunk.error);

  const updPersona = await visitor.client.from("personas").update({ name: "defaced" }).eq("user_id", ownerId).select("id");
  check("cannot update a demo persona", (updPersona.data?.length ?? 0) === 0);
  const delPersona = await visitor.client.from("personas").delete().eq("user_id", ownerId).select("id");
  check("cannot delete a demo persona", (delPersona.data?.length ?? 0) === 0);

  const up = await visitor.client.storage.from(BUCKET).upload(audioPath, new Blob(["x"]), { upsert: true });
  check("cannot overwrite the demo recording", !!up.error);
  const upOwn = await visitor.client.storage.from(BUCKET).upload(`${visitor.id}/x`, new Blob(["x"]));
  check("cannot upload a recording of its own", !!upOwn.error);
  await visitor.client.storage.from(BUCKET).remove([audioPath]);
  const stillThere = await admin.storage.from(BUCKET).download(audioPath);
  check("cannot delete the demo recording", !stillThere.error);

  const { count: chunksAfter } = await admin
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId);
  const { data: notesAfter } = await admin.from("notes").select("title").in("id", demoIds);
  check(
    "the demo is unchanged after every attempt",
    chunksAfter === demoChunkCount && notesAfter.every((n) => n.title !== "defaced"),
  );

  // ------------------------------------------------------------ real account
  console.log("\n--- a real account does not gain the demo ---");
  const rNotes = await owner.client.from("notes").select("id").in("id", demoIds);
  check("reads no demo note", !rNotes.error && rNotes.data.length === 0, `${rNotes.data?.length ?? 0} rows`);
  const rChunks = await owner.client.from("note_chunks").select("id").in("note_id", demoIds);
  check("reads no demo chunk", !rChunks.error && rChunks.data.length === 0);
  const rPersonas = await owner.client.from("personas").select("id").eq("user_id", ownerId);
  check("reads no demo persona", !rPersonas.error && rPersonas.data.length === 0);
  const rAudio = await owner.client.storage.from(BUCKET).download(audioPath);
  check("cannot download the demo recording", !!rAudio.error);

  // ------------------------------------------------------------ search
  console.log("\n--- chunk search returns demo chunks to a visitor, and nothing else ---");
  // A demo chunk's own stored embedding as the query: no Voyage call needed.
  const { data: seed } = await admin
    .from("note_chunks")
    .select("embedding, content")
    .eq("user_id", ownerId)
    .eq("chunk_type", "summary")
    .limit(1)
    .single();
  const vSearch = await visitor.client.rpc("search_note_chunks", {
    query_embedding: seed.embedding,
    query_text: "recording",
  });
  check(
    "visitor search finds demo chunks, all of them demo",
    !vSearch.error && vSearch.data.length > 0 && vSearch.data.every((r) => demoIds.includes(r.note_id)),
    vSearch.error?.message ?? `${vSearch.data.length} results`,
  );
  const rSearch = await owner.client.rpc("search_note_chunks", {
    query_embedding: seed.embedding,
    query_text: "recording",
  });
  check(
    "real-account search finds no demo chunk",
    !rSearch.error && rSearch.data.every((r) => !demoIds.includes(r.note_id)),
  );

  // ------------------------------------------------------------ chat
  console.log("\n--- chat: a demo note yes, anybody else's no, each visitor alone ---");
  const chatDemo = await visitor.client
    .from("chat_messages")
    .insert({ note_id: demoIds[0], user_id: visitor.id, role: "user", content: "demo probe", scope: "this_note" })
    .select("id")
    .single();
  check("visitor can ask about a demo note", !chatDemo.error, chatDemo.error?.message);
  const chatReal = await visitor.client
    .from("chat_messages")
    .insert({ note_id: probeNoteId, user_id: visitor.id, role: "user", content: "x", scope: "this_note" });
  check("visitor cannot ask about a real account's note", !!chatReal.error);
  const otherRead = await other.client.from("chat_messages").select("id").eq("note_id", demoIds[0]);
  check(
    "another visitor does not see that question",
    !otherRead.error && otherRead.data.length === 0,
    `${otherRead.data?.length ?? 0} rows`,
  );
  const ownerChat = await owner.client
    .from("chat_messages")
    .insert({ note_id: demoIds[0], user_id: owner.id, role: "user", content: "x", scope: "this_note" });
  check("a real account cannot ask about a demo note", !!ownerChat.error);

  // ------------------------------------------------------------ trigger
  console.log("\n--- a visit creates one auth row, no personas ---");
  const { count: visitorPersonas } = await admin
    .from("personas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", visitor.id);
  check("the persona trigger skipped the visitor", visitorPersonas === 0, `${visitorPersonas} personas`);

  // ------------------------------------------------------------ cleanup job
  console.log("\n--- the cleanup job deletes old visitors and never a real account ---");
  const expired = await newVisitor();
  const expiredChat = await expired.client
    .from("chat_messages")
    .insert({ note_id: demoIds[0], user_id: expired.id, role: "user", content: "old", scope: "this_note" });
  if (expiredChat.error) throw new Error(`expired visitor chat failed: ${expiredChat.error.message}`);
  const realEmail = `demo-rls-real-${Date.now()}@squid-ink.test`;
  const real = await admin.auth.admin.createUser({
    email: realEmail,
    password: `${crypto.randomUUID()}-Aa1!`,
    email_confirm: true,
  });
  if (real.error) throw new Error(`real probe account failed: ${real.error.message}`);
  created.push(real.data.user.id);
  await managementQuery(
    `update auth.users set created_at = now() - interval '8 days' ` +
      `where id in ('${expired.id}', '${real.data.user.id}')`,
  );
  const [{ delete_expired_demo_visitors: removed }] = await managementQuery(
    "select public.delete_expired_demo_visitors()",
  );
  const expiredAfter = await admin.auth.admin.getUserById(expired.id);
  const realAfter = await admin.auth.admin.getUserById(real.data.user.id);
  const visitorAfter = await admin.auth.admin.getUserById(visitor.id);
  check("an 8-day-old visitor is deleted", !expiredAfter.data?.user, `${removed} removed in this run`);
  check("an 8-day-old real account is kept", !!realAfter.data?.user);
  check("a new visitor is kept", !!visitorAfter.data?.user);
  // service_role holds no grant on chat_messages, so this count goes through
  // the management API too.
  const [{ n: chatAfter }] = await managementQuery(
    `select count(*)::int as n from public.chat_messages where user_id = '${expired.id}'`,
  );
  check("a deleted visitor's chat goes with it", chatAfter === 0, `${chatAfter} rows left`);
} catch (error) {
  failures += 1;
  console.log(`\n  FAIL  ${error.message}`);
} finally {
  if (probeNoteId && owner) await owner.client.from("notes").delete().eq("id", probeNoteId);
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`\ncleaned up ${created.length} test identities and the probe note`);
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
