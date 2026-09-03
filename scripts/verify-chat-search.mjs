/**
 * Six proofs for search_note_chunks, run against the live project as a real
 * signed-in user so RLS is exercised rather than bypassed.
 *
 * What each proof is actually for:
 *
 *   1  a transcript_segment chunk is retrievable
 *   2  a structured (takeaway) chunk is retrievable
 *   3  the result cap holds: never more than 25, proved against a note that
 *      has 32 matching chunks rather than against a query that returns 3
 *   4  a note OUTSIDE the 90-day window is never considered, even when its
 *      content is the best match in the database
 *   5  the 26th-most-recent in-window note is never considered, which is the
 *      `limit 25` pool bound and is a different bound from proof 4
 *   6  one Voyage call per query -- the counter is the cost proof
 *
 * Proofs 4 and 5 are deliberately separate. The candidate clause is a single
 * statement that yields whichever bound is smaller, so a change that broke
 * one bound while leaving the other intact would pass a combined test.
 *
 * Node 24 strips TypeScript natively and the resolve hook below maps "@/" the
 * way the app's tsconfig does, so this script imports the SHIPPED modules
 * rather than a second copy of them. That is the point: a copy cannot drift,
 * because there is no copy.
 *
 * Needs .env.local (VOYAGE_API_KEY, the RLS test user). No dev server.
 * Paces itself for a throttled Voyage account; a card is on file as of
 * 2026-09-03, so run with VOYAGE_MIN_CALL_INTERVAL_MS=0 for seconds instead
 * of minutes. Keep the default -- it is what makes this runnable on an
 * account that gets throttled again.
 *
 *   VOYAGE_MIN_CALL_INTERVAL_MS=0 node scripts/verify-chat-search.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

const { createVoyageEmbedder } = await import(
  new URL("lib/rag/voyage-client.ts", ROOT).href
);
const { createVoyageQueryEmbedder } = await import(
  new URL("lib/rag/query-embed.ts", ROOT).href
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: session, error: signInError } = await anon.auth.signInWithPassword(
  { email: env.RLS_TEST_OWNER_EMAIL, password: env.RLS_TEST_OWNER_PASSWORD },
);
if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

const role = roleClaim(session.session.access_token);
if (role !== "authenticated") {
  throw new Error(
    `refusing to run as role "${role}" — this proof is meaningless unless RLS ` +
      `applies, and service_role bypasses it entirely`,
  );
}

const owner = createClient(url, publishableKey, {
  global: {
    headers: { Authorization: `Bearer ${session.session.access_token}` },
  },
  auth: { persistSession: false, autoRefreshToken: false },
});
const userId = session.user.id;

/** Same reasoning as verify-embeddings-pipeline.mjs: 31 s, not 21 s. The
 *  unbilled limit is 3 requests per ROLLING 60 s window, so 21 s start-to-start
 *  puts three calls inside one window right on the boundary and any jitter
 *  trips it. */
const MIN_CALL_INTERVAL_MS = Number(env.VOYAGE_MIN_CALL_INTERVAL_MS ?? 31_000);
let lastCallAt = 0;
async function paced(fn) {
  const wait = lastCallAt + MIN_CALL_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  return fn();
}

// The counter is the whole of proof 6. Everything under it is the real thing.
let queryCalls = 0;
const rawQueryEmbedder = createVoyageQueryEmbedder(env.VOYAGE_API_KEY);
const embedQuery = async (text) => {
  queryCalls += 1;
  return paced(() => rawQueryEmbedder(text));
};
const embedDocuments = createVoyageEmbedder(env.VOYAGE_API_KEY);

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const TRANSCRIPT_TEXT =
  "We raised the quarterly budget to four hundred thousand dollars.";
const TAKEAWAY_TEXT =
  "Approve the vendor contract renewal before the fiscal deadline.";

const noteIds = { target: crypto.randomUUID(), pushed: crypto.randomUUID(), old: crypto.randomUUID() };
const fillerNoteIds = Array.from({ length: 25 }, () => crypto.randomUUID());

/** Notes are dated so the candidate pool resolves to exactly:
 *    target (newest) + the 24 newest fillers  = 25
 *  which pushes `pushed` out at 26th, and `old` out by BOTH bounds. */
const NOTES = [
  { id: noteIds.target, title: "chat search probe - target", created_at: ago(1) },
  ...fillerNoteIds.map((id, i) => ({
    id,
    title: `chat search probe - filler ${i}`,
    created_at: ago(2 + i),
  })),
  { id: noteIds.pushed, title: "chat search probe - pushed out of the pool", created_at: ago(40) },
  { id: noteIds.old, title: "chat search probe - older than 90 days", created_at: ago(100) },
];

const chunkIds = {};

async function seed() {
  for (const note of NOTES) {
    const { error } = await owner
      .from("notes")
      .insert({ ...note, user_id: userId, processing_status: "completed" });
    if (error) throw new Error(`seed note failed: ${error.message}`);
  }

  // 30 fillers so proof 3 has more than 25 matches to cap; plus the two
  // chunks proofs 1 and 2 look for.
  const targetChunks = [
    ...Array.from({ length: 30 }, (_, i) => ({
      chunk_type: "transcript_segment",
      content: `The team met to review the meeting agenda, item number ${i}.`,
      metadata: { seq: i + 1, ts_start: `0${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}` },
    })),
    {
      chunk_type: "transcript_segment",
      content: TRANSCRIPT_TEXT,
      metadata: { seq: 31, ts_start: "04:12" },
    },
    { chunk_type: "takeaway", content: TAKEAWAY_TEXT, metadata: { seq: 1 } },
  ];

  const rows = [
    ...targetChunks.map((c) => ({ ...c, note_id: noteIds.target })),
    // Deliberately the SAME text as the target's transcript chunk. If either
    // of these ever comes back, it is because a bound failed — not because
    // the ranking preferred it.
    { note_id: noteIds.pushed, chunk_type: "transcript_segment", content: TRANSCRIPT_TEXT, metadata: { seq: 1, ts_start: "01:00" } },
    { note_id: noteIds.old, chunk_type: "transcript_segment", content: TRANSCRIPT_TEXT, metadata: { seq: 1, ts_start: "01:00" } },
  ];

  const vectors = await paced(() => embedDocuments(rows.map((r) => r.content)));

  for (let i = 0; i < rows.length; i += 1) {
    const { data, error } = await owner
      .from("note_chunks")
      .insert({
        ...rows[i],
        user_id: userId,
        embedding: JSON.stringify(vectors[i]),
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed chunk failed: ${error.message}`);
    if (rows[i].note_id === noteIds.pushed) chunkIds.pushed = data.id;
    if (rows[i].note_id === noteIds.old) chunkIds.old = data.id;
    if (rows[i].content === TRANSCRIPT_TEXT && rows[i].note_id === noteIds.target)
      chunkIds.transcript = data.id;
    if (rows[i].content === TAKEAWAY_TEXT) chunkIds.takeaway = data.id;
  }
}

async function cleanup() {
  // As the OWNER, never the admin: service_role bypasses RLS and would
  // silently succeed while proving nothing about the delete policy.
  for (const note of NOTES) {
    await owner.from("notes").delete().eq("id", note.id);
  }
}

async function search(question) {
  const vector = await embedQuery(question);
  const { data, error } = await owner.rpc("search_note_chunks", {
    query_embedding: JSON.stringify(vector),
    query_text: question,
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

let failed = false;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
};

console.log(`signed in as ${env.RLS_TEST_OWNER_EMAIL}  role=${role}`);
console.log(`pacing: ${MIN_CALL_INTERVAL_MS} ms between Voyage calls`);
console.log("");

try {
  await seed();
  console.log(`seeded ${NOTES.length} notes and 34 chunks`);
  console.log(`  target note (in pool)      : ${noteIds.target}`);
  console.log(`  pushed note (26th, in date): ${noteIds.pushed}`);
  console.log(`  old note (100 days ago)    : ${noteIds.old}`);
  console.log("");

  // ------------------------------------------------------------------ 1 & 2
  console.log("--- proof 1: a transcript_segment chunk is retrievable ---");
  const r1 = await search("how much did we raise the quarterly budget to?");
  console.log(`  rows=${r1.length}  top chunk_type=${r1[0]?.chunk_type}`);
  check(
    "the transcript chunk came back",
    r1.some((r) => r.chunk_id === chunkIds.transcript),
  );
  check("it carries its note's title", r1.some((r) => r.note_title?.includes("target")));

  console.log("");
  console.log("--- proof 2: a structured (takeaway) chunk is retrievable ---");
  const r2 = await search("what do we need to approve before the fiscal deadline?");
  console.log(`  rows=${r2.length}`);
  check(
    "the takeaway chunk came back",
    r2.some((r) => r.chunk_id === chunkIds.takeaway),
  );
  check(
    "it is typed as a takeaway, not a transcript segment",
    r2.find((r) => r.chunk_id === chunkIds.takeaway)?.chunk_type === "takeaway",
  );

  // ---------------------------------------------------------------------- 3
  console.log("");
  console.log("--- proof 3: never more than 25 results ---");
  const r3 = await search("meeting agenda review");
  console.log(`  rows=${r3.length}  (the target note alone carries 32 chunks)`);
  check("at most 25", r3.length <= 25, `got ${r3.length}`);
  check("and the cap actually bit", r3.length === 25, `got ${r3.length}`);

  // ----------------------------------------------------------------- 4 & 5
  console.log("");
  console.log("--- proofs 4 & 5: both pool bounds hold ---");
  const all = [...r1, ...r2, ...r3];
  console.log(`  ${all.length} rows seen across all three queries`);
  check(
    "a note older than 90 days never appears, despite identical best-match text",
    !all.some((r) => r.chunk_id === chunkIds.old || r.note_id === noteIds.old),
  );
  check(
    "the 26th-most-recent in-window note never appears either",
    !all.some((r) => r.chunk_id === chunkIds.pushed || r.note_id === noteIds.pushed),
  );

  // ---------------------------------------------------------------------- 6
  console.log("");
  console.log("--- proof 6: one Voyage query call per search ---");
  console.log(`  searches=3  query calls=${queryCalls}`);
  check("exactly one call per query", queryCalls === 3, `got ${queryCalls}`);
} finally {
  await cleanup();
  console.log("");
  console.log("cleaned up as the owner");
}

console.log("");
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
