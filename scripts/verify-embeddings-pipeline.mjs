/**
 * Live proof of the EMBEDDINGS POPULATION PIPELINE against the hosted project
 * and the real Voyage API.
 *
 * It imports the SHIPPED modules rather than re-implementing them:
 *
 *     lib/rag/embed-note.ts       embedChunks, embedNoteChunks
 *     lib/rag/sweep.ts            embeddingSweep, MAX_EMBED_ATTEMPTS
 *     lib/rag/supabase-ports.ts   createEmbeddingPorts
 *     lib/rag/voyage-client.ts    createVoyageEmbedder, VoyageError
 *
 * Node 24 strips TypeScript natively and the resolve hook below maps this
 * project's "@/" alias onto the repo root, so the import is the real module —
 * a copy here would only prove that the copy agrees with itself.
 *
 * ports.embed is wrapped in a COUNTER. "Zero Voyage calls on a fully embedded
 * table" and "no call spent on an exhausted chunk" are therefore MEASURED, not
 * asserted.
 *
 * NO DEV SERVER NEEDED. Runs against the authenticated (RLS) client throughout,
 * which is what the Server Action uses, and deletes its rows as the OWNER in
 * the finally block — exercising the RLS path a real user takes. note_chunks
 * cascade from notes.id.
 *
 * IT PACES ITSELF. A Voyage account with no payment method is capped at 3
 * requests per minute, so calls are spaced 21 s apart by default and a full
 * run takes several minutes. Set VOYAGE_MIN_CALL_INTERVAL_MS=0 in .env.local
 * once the account is billed. The pacing is in this harness only — the shipped
 * pipeline deliberately does not back off. See MIN_CALL_INTERVAL_MS below.
 *
 *   node scripts/verify-embeddings-pipeline.mjs
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

const { createEmbeddingPorts } = await import(
  new URL("lib/rag/supabase-ports.ts", ROOT).href
);
const { embedChunks, embedNoteChunks } = await import(
  new URL("lib/rag/embed-note.ts", ROOT).href
);
const { embeddingSweep, MAX_EMBED_ATTEMPTS, EMBED_CHUNK_WINDOW } = await import(
  new URL("lib/rag/sweep.ts", ROOT).href
);
const { createVoyageEmbedder, VoyageError, VOYAGE_MODEL, VOYAGE_OUTPUT_DIMENSION } =
  await import(new URL("lib/rag/voyage-client.ts", ROOT).href);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

/** Read the role claim without verifying — we only need to prove we are NOT
 *  running as service_role. Postgres does the real verification. */
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

/** pgvector hands a vector back as its text form, "[0.1,0.2,…]". */
function parseVector(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  return JSON.parse(value);
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const env = loadEnv(".env.local");

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "RLS_TEST_OWNER_EMAIL",
  "RLS_TEST_OWNER_PASSWORD",
]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

if (!env.VOYAGE_API_KEY) {
  throw new Error(
    "VOYAGE_API_KEY is missing from .env.local. Add it (server-only, never " +
      "NEXT_PUBLIC_) and re-run — this script spends real Voyage quota and " +
      "cannot prove anything without it.",
  );
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

const token = signIn.session.access_token;
const role = roleClaim(token);
if (role !== "authenticated") {
  throw new Error(
    `refusing to trust a result from role "${role}" — the inline trigger runs ` +
      `as the signed-in user, so the proof requires the authenticated role`,
  );
}

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;

/** THE FREE-TIER THROTTLE, and why this script has one.
 *
 *  A Voyage account with no payment method on file is limited to 3 requests
 *  per minute and 10,000 tokens per minute — not the 2,000 RPM / 8,000,000 TPM
 *  tier-1 numbers the docs quote for a billed account. Measured on 2026-09-03,
 *  when an unthrottled run of this script drew a 429 whose body says so
 *  outright.
 *
 *  The SHIPPED pipeline does not back off, and deliberately: it classifies a
 *  429 as transient, leaves the chunk's attempt counter untouched and lets the
 *  row stay eligible for the next sweep. That is the right behaviour for a
 *  daily cron on a billed account. But it makes THIS script's proofs
 *  unrunnable on the free tier, because a chunk that 429s never embeds and
 *  Proof 6 has nothing to observe.
 *
 *  So the pacing lives here, in the harness, and not in lib/rag. Set
 *  VOYAGE_MIN_CALL_INTERVAL_MS=0 once the account is billed to run at full
 *  speed. */
const MIN_CALL_INTERVAL_MS = Number(env.VOYAGE_MIN_CALL_INTERVAL_MS ?? 21_000);
let lastCallAt = 0;

async function paced(fn) {
  const wait = lastCallAt + MIN_CALL_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
  return fn();
}

// The counters are the whole cost proof. Everything else is the real thing.
const realPorts = createEmbeddingPorts(owner, env.VOYAGE_API_KEY);
let voyageCalls = 0;
/** Calls whose payload actually contained the poison chunk. "No further call
 *  is spent ON IT" is a claim about this number, never about the total — a
 *  sibling that is still legitimately eligible will keep being retried, and
 *  counting that as a failure would be measuring the wrong thing. */
let poisonCalls = 0;

const embedCounted = async (texts) => {
  voyageCalls += 1;
  if (texts.some((t) => t.startsWith("POISON:"))) poisonCalls += 1;
  return paced(() => realPorts.embed(texts));
};

const ports = { ...realPorts, embed: embedCounted };

const created = [];

async function seedNote(title) {
  const { data, error } = await owner
    .from("notes")
    .insert({
      user_id: userId,
      title,
      processing_status: "completed",
      raw_transcript: "seeded by verify-embeddings-pipeline",
      notegen_status: "completed",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seeding "${title}" failed: ${error.message}`);
  created.push(data.id);
  return data.id;
}

async function seedChunk(noteId, content, metadata = {}) {
  const { data, error } = await owner
    .from("note_chunks")
    .insert({
      note_id: noteId,
      user_id: userId,
      chunk_type: "transcript_segment",
      persona_id: null,
      content,
      embedding: null,
      metadata,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seeding a chunk failed: ${error.message}`);
  return data.id;
}

async function chunkRow(id) {
  const { data, error } = await owner
    .from("note_chunks")
    .select("id, content, embedding, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`reading chunk ${id} failed: ${error.message}`);
  return data;
}

async function pendingCount() {
  const { count, error } = await owner
    .from("note_chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);
  if (error) throw new Error(`counting pending chunks failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

try {
  console.log(`\nsigned in as ${env.RLS_TEST_OWNER_EMAIL} (role ${role})`);
  console.log(`user_id ${userId}`);
  console.log(`model   ${VOYAGE_MODEL} @ ${VOYAGE_OUTPUT_DIMENSION} dims\n`);

  // ---- Proof 1 -------------------------------------------------------------
  console.log("Proof 1 — semantic sanity: similar text ranks closer than unrelated");
  const raw = createVoyageEmbedder(env.VOYAGE_API_KEY);
  const [anchor, similar, unrelated] = await raw([
    "The team agreed to ship the mapping work before the billing migration.",
    "We decided mapping goes out first and billing waits until it is green.",
    "The kitchen tap has been dripping since Tuesday and needs a new washer.",
  ]);

  const near = cosine(anchor, similar);
  const far = cosine(anchor, unrelated);
  console.log(`  cosine(anchor, similar)   = ${near.toFixed(4)}`);
  console.log(`  cosine(anchor, unrelated) = ${far.toFixed(4)}`);
  check("the similar pair ranks closer", near > far, `(${(near - far).toFixed(4)} apart)`);
  check(
    "vectors are the pinned width",
    anchor.length === VOYAGE_OUTPUT_DIMENSION,
    `(${anchor.length})`,
  );

  // ---- Proof 2 -------------------------------------------------------------
  console.log("\nProof 2 — a note's chunks get real vectors, in one Voyage call");
  const note1 = await seedNote("embeddings proof 1");
  const c1 = await seedChunk(note1, "Mapping ships before the billing migration.", {
    seq: 0,
    ts_start: "00:00",
  });
  const c2 = await seedChunk(note1, "Ravi circulates the sequencing plan on Thursday.", {
    seq: 1,
    ts_start: "00:12",
  });

  const before2 = voyageCalls;
  const report2 = await embedNoteChunks(ports, note1);
  console.log(`  report: ${JSON.stringify(report2)}`);

  check("both chunks embedded", report2.embedded === 2, `(${report2.embedded})`);
  check("exactly one Voyage call", voyageCalls - before2 === 1, `(${voyageCalls - before2})`);

  const stored = parseVector((await chunkRow(c1)).embedding);
  check(
    "the stored vector is 1024-wide",
    stored?.length === VOYAGE_OUTPUT_DIMENSION,
    `(${stored?.length})`,
  );
  check("the stored vector is not all zeroes", stored?.some((v) => v !== 0));

  const kept = (await chunkRow(c2)).metadata;
  check(
    "the chunk's own metadata survived",
    kept.seq === 1 && kept.ts_start === "00:12",
    JSON.stringify(kept),
  );

  // ---- Proof 3 -------------------------------------------------------------
  console.log("\nProof 3 — a fully embedded note costs zero Voyage calls");
  const before3 = voyageCalls;
  const report3 = await embedNoteChunks(ports, note1);
  check("nothing left to embed", report3.embedded === 0, JSON.stringify(report3));
  check("no Voyage call", voyageCalls - before3 === 0, `(${voyageCalls - before3})`);

  // ---- Proof 4 -------------------------------------------------------------
  console.log("\nProof 4 — the sweep backfills chunks the inline path never saw");
  const note2 = await seedNote("embeddings proof 4 (backfill)");
  await seedChunk(note2, "Priya flagged that the old customer IDs must survive.");
  await seedChunk(note2, "Dana asked for the assumption to be written down.");

  const pendingBefore = await pendingCount();
  const before4 = voyageCalls;
  const report4 = await embeddingSweep(ports, { deadlineAt: Date.now() + 120_000 });
  const pendingAfter = await pendingCount();

  console.log(`  sweep report: ${JSON.stringify(report4)}`);
  console.log(`  rows with embedding IS NULL: ${pendingBefore} before -> ${pendingAfter} after`);
  check("the sweep embedded the backlog", report4.embedded >= 2, `(${report4.embedded})`);
  check("the pending count fell", pendingAfter < pendingBefore, `(${pendingBefore} -> ${pendingAfter})`);
  check("it spent at least one call", voyageCalls - before4 >= 1, `(${voyageCalls - before4})`);

  // ---- Proofs 5 and 6 ------------------------------------------------------
  console.log(
    `\nProofs 5 & 6 — a poison chunk gives up after ${MAX_EMBED_ATTEMPTS}, its sibling does not wait`,
  );
  const note3 = await seedNote("embeddings proof 5 (poison)");
  const poison = await seedChunk(note3, "POISON: this chunk always fails to embed.", {
    seq: 0,
  });
  const sibling = await seedChunk(
    note3,
    "A perfectly healthy sibling chunk in the same note.",
    { seq: 1 },
  );

  // The failure is INJECTED at the client boundary, which is the honest way to
  // force one: nothing in real content reliably makes Voyage return a 400, and
  // asserting the cap without exercising it would prove nothing. Everything
  // else below the injection is the shipped code, against the real table.
  const poisonPorts = {
    ...realPorts,
    embed: async (texts) => {
      voyageCalls += 1;
      if (texts.some((t) => t.startsWith("POISON:"))) {
        poisonCalls += 1;
        throw new VoyageError("injected 400 for the poison chunk", "content", 400);
      }
      return paced(() => realPorts.embed(texts));
    },
  };

  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt += 1) {
    const pending = await realPorts.listPendingForNote(note3, EMBED_CHUNK_WINDOW);
    const run = await embedChunks(poisonPorts, pending);
    const row = await chunkRow(poison);
    console.log(
      `  run ${attempt}: listed=${pending.length} embed_attempts=${row.metadata.embed_attempts} ` +
        `report=${JSON.stringify(run)}`,
    );
    check(`run ${attempt} records attempt ${attempt}`, row.metadata.embed_attempts === attempt);

    if (attempt === 1) {
      const sib = await chunkRow(sibling);
      check(
        "PROOF 6: the healthy sibling embedded on the FIRST run",
        parseVector(sib.embedding)?.length === VOYAGE_OUTPUT_DIMENSION,
      );
      check(
        "PROOF 6: the sibling was never charged an attempt",
        sib.metadata.embed_attempts === undefined,
        JSON.stringify(sib.metadata),
      );
    }
  }

  const afterCap = await realPorts.listPendingForNote(note3, EMBED_CHUNK_WINDOW);
  check(
    "PROOF 5: the exhausted chunk is no longer listed as pending",
    afterCap.every((c) => c.id !== poison),
    `(${afterCap.length} still pending in this note)`,
  );

  // Measured on POISON calls, not on the total. A healthy sibling that is
  // still eligible will legitimately be retried on this run, and counting that
  // against the cap would be measuring the wrong thing entirely.
  const beforePoison = poisonCalls;
  const afterReport = await embedNoteChunks(poisonPorts, note3);
  check(
    "PROOF 5: a further run spends no Voyage call ON THE POISON CHUNK",
    poisonCalls - beforePoison === 0,
    `(${poisonCalls - beforePoison}, report ${JSON.stringify(afterReport)})`,
  );

  const finalPoison = await chunkRow(poison);
  check("PROOF 5: its embedding is still null", finalPoison.embedding === null);
  check(
    "PROOF 5: its metadata records the reason",
    typeof finalPoison.metadata.embed_error === "string",
    finalPoison.metadata.embed_error,
  );
  check("PROOF 5: its own seq survived the merges", finalPoison.metadata.seq === 0);

  console.log(`\ntotal Voyage calls across all proofs: ${voyageCalls}`);
  console.log(`of which reached the poison chunk:   ${poisonCalls}`);
} finally {
  // As the OWNER, never the admin. This exercises the RLS delete path a real
  // user takes; note_chunks cascade on notes.id.
  for (const id of created) {
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.error(`  cleanup: could not delete ${id}: ${error.message}`);
  }
  console.log(`cleaned up ${created.length} note row(s) as the owner`);
}

console.log(failed ? "\nFAILED\n" : "\nPASSED\n");
process.exit(failed ? 1 : 0);
