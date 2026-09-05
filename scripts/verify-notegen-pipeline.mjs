/**
 * Live proof of STRUCTURED NOTE GENERATION against the hosted project and the
 * real Gemini API.
 *
 * The thing being proved is the atomic claim and its cost guarantee, so this
 * script imports the SHIPPED functions rather than re-implementing them:
 *
 *     lib/notegen/generate-note.ts   claimAndGenerate
 *     lib/notegen/notegen-ports.ts   createNotegenPorts, resolvePersonaFor
 *
 * Node 24 strips TypeScript natively, and the resolve hook below maps this
 * project's "@/" alias onto the repo root, so the import is the real module —
 * a copy in this file would only prove that the copy agrees with itself.
 *
 * ports.generate is wrapped in a counter. "Exactly one Gemini call" and "no
 * second call" are therefore MEASURED, not asserted: the counter is read
 * before and after every attempt.
 *
 * NO AUDIO, NO STORAGE, NO TRANSCRIPTION. This pipeline is text-only, so the
 * fixture is a text transcript written straight onto a row at
 * processing_status = 'completed'. That is deliberately NOT a shortcut around
 * the guard — the claim requires exactly that state, and a row in any other
 * state is what Proof 2 and Proof 5 exercise.
 *
 * Six proofs:
 *
 *   1. A completed note with a real transcript reaches
 *      notegen_status = 'completed' with real chunks behind it, for exactly
 *      one Gemini call — AND, seeded with a null title, comes back carrying a
 *      real content-derived one. The call count is what proves the title was
 *      one more field on that same call rather than a second billed call.
 *   2. A repeat claim on that same row is contended, and the counter does not
 *      move.
 *   3. Two concurrent claims on one fresh row yield exactly one winner, and
 *      the counter rises by exactly one.
 *   4. Persona resolution reports which branch executed — a named-row match or
 *      DEFAULT_PERSONA_FALLBACK — and that the query was scoped by slug.
 *   5. A completed note with a whitespace transcript goes terminal without a
 *      Gemini call.
 *   6. A note seeded with a hand-typed title generates normally and comes back
 *      wearing that same title — the null-guard's guarantee, measured against
 *      the live database rather than against a fake builder chain.
 *
 * Runs against the authenticated (RLS) client throughout, which is what the
 * Server Action uses. It needs NO dev server.
 *
 *   node scripts/verify-notegen-pipeline.mjs
 *
 * Rows are deleted as the OWNER in the finally block, exercising the RLS path
 * a real user takes; note_chunks cascade. A script that deleted as the admin
 * would silently succeed while proving nothing about RLS.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

/** Three speakers, real decisions, real commitments. Long enough that a model
 *  has something to summarise, short enough to read in the failure output. */
const TRANSCRIPT = [
  "Dana: Before anything else — are we still shipping the mapping work before billing?",
  "Ravi: Yes. Mapping first. Billing migration holds until mapping is green in staging.",
  "Dana: Agreed. Ravi, can you have the sequencing plan drafted by Friday?",
  "Ravi: I can. I'll circulate it Thursday night so there's a day to react.",
  "Priya: One risk — the billing migration assumes the old customer IDs survive. If mapping renumbers them we lose a week.",
  "Dana: Good catch. Ravi, put that assumption in the plan explicitly.",
  "Ravi: Will do. I'll also flag it to the data team before Thursday.",
  "Dana: Then we're decided. Mapping first, plan Thursday, billing holds.",
].join("\n");

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

const { createNotegenPorts, resolvePersonaFor } = await import(
  new URL("lib/notegen/notegen-ports.ts", ROOT).href
);
const { claimAndGenerate } = await import(
  new URL("lib/notegen/generate-note.ts", ROOT).href
);
const { DEFAULT_PERSONA_ID } = await import(
  new URL("lib/notes/default-persona.ts", ROOT).href
);
const { MAX_TITLE_LENGTH } = await import(
  new URL("lib/notegen/persist-result.ts", ROOT).href
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

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

for (const name of [
  "GEMINI_API_KEY",
  "SUPABASE_SECRET_KEY",
  "RLS_TEST_OWNER_EMAIL",
  "RLS_TEST_OWNER_PASSWORD",
]) {
  if (!env[name]) throw new Error(`${name} is missing from .env.local`);
}

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

// The counter is the whole cost proof. Everything else is the real thing.
const realPorts = createNotegenPorts(owner, env.GEMINI_API_KEY);
let geminiCalls = 0;
const ports = {
  ...realPorts,
  generate: async (request) => {
    geminiCalls += 1;
    return realPorts.generate(request);
  },
};

const created = [];

/** A row in exactly the state the claim guard requires. No audio path and no
 *  duration: this pipeline reads neither. */
async function seedNote(title, transcript) {
  const { data, error } = await owner
    .from("notes")
    .insert({
      user_id: userId,
      title,
      processing_status: "completed",
      raw_transcript: transcript,
      notegen_status: null,
    })
    .select("id, user_id, raw_transcript, updated_at")
    .single();

  if (error) throw new Error(`seeding "${title}" failed: ${error.message}`);
  created.push(data.id);
  return data;
}

async function statusOf(noteId) {
  const { data } = await owner
    .from("notes")
    .select("notegen_status")
    .eq("id", noteId)
    .maybeSingle();
  return data?.notegen_status ?? null;
}

async function titleOf(noteId) {
  const { data } = await owner
    .from("notes")
    .select("title")
    .eq("id", noteId)
    .maybeSingle();
  return data?.title ?? null;
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

try {
  console.log(`\nsigned in as ${env.RLS_TEST_OWNER_EMAIL} (role ${role})`);
  console.log(`user_id ${userId}\n`);

  // ---- Proof 4 first: it tells the other proofs which lens they exercised --
  console.log("Proof 4 — persona resolution");
  const persona = await resolvePersonaFor(owner, userId);
  console.log(
    `  resolved: slug=${persona.slug} depth=${persona.depth} ` +
      `name="${persona.name}" source=${persona.source}`,
  );
  check(
    "resolved by slug, matching DEFAULT_PERSONA_ID",
    persona.slug === DEFAULT_PERSONA_ID,
    `(${persona.slug})`,
  );
  check(
    "reports which branch executed",
    persona.source === "row" || persona.source === "fallback",
    `(${persona.source})`,
  );

  // ---- Proof 1 -------------------------------------------------------------
  console.log("\nProof 1 — a completed note generates, for one Gemini call");
  const before1 = geminiCalls;
  // Seeded with NO title, deliberately. Every note here used to arrive already
  // named, which meant the auto-titling write's null-guard matched zero rows
  // and the write itself was never exercised against the live database.
  const note1 = await seedNote(null, TRANSCRIPT);
  const outcome1 = await claimAndGenerate(ports, note1);

  check("outcome is 'generated'", outcome1 === "generated", `(${outcome1})`);
  check(
    "exactly one Gemini call",
    geminiCalls - before1 === 1,
    `(${geminiCalls - before1})`,
  );
  check(
    "row reads notegen_status = 'completed'",
    (await statusOf(note1.id)) === "completed",
  );

  const { data: chunks } = await owner
    .from("note_chunks")
    .select("chunk_type, content, persona_id, embedding, metadata")
    .eq("note_id", note1.id)
    .in("chunk_type", ["summary", "takeaway", "action_item"]);

  check("wrote at least one generated chunk", (chunks?.length ?? 0) > 0, `(${chunks?.length ?? 0})`);
  check(
    "every generated chunk has persona_id null",
    (chunks ?? []).every((c) => c.persona_id === null),
  );
  check(
    "every generated chunk has embedding null",
    (chunks ?? []).every((c) => c.embedding === null),
  );
  check(
    "no chunk content is blank",
    (chunks ?? []).every((c) => c.content.trim().length > 0),
  );

  // The title is ONE MORE FIELD on the call counted above — the count is the
  // proof that no second, separately-billed call produced it.
  const title1 = await titleOf(note1.id);
  console.log(`  title: ${JSON.stringify(title1)}`);
  check("the row now carries a real title", Boolean(title1?.trim()));
  check(
    "it is not the render-time fallback",
    title1 !== "Untitled note",
    `(${title1})`,
  );
  check(
    `it is at most ${MAX_TITLE_LENGTH} characters`,
    (title1?.length ?? 0) <= MAX_TITLE_LENGTH,
    `(${title1?.length})`,
  );

  const byType = {};
  for (const c of chunks ?? []) byType[c.chunk_type] = (byType[c.chunk_type] ?? 0) + 1;
  console.log(`  chunks by type: ${JSON.stringify(byType)}`);
  for (const c of chunks ?? []) {
    console.log(`    [${c.chunk_type}] ${c.content.slice(0, 96)}`);
  }

  // ---- Proof 2 -------------------------------------------------------------
  console.log("\nProof 2 — a repeat claim is contended, and free");
  const before2 = geminiCalls;
  const outcome2 = await claimAndGenerate(ports, note1);
  check("outcome is 'contended'", outcome2 === "contended", `(${outcome2})`);
  check(
    "no additional Gemini call",
    geminiCalls - before2 === 0,
    `(${geminiCalls - before2})`,
  );
  check(
    "row is still 'completed', not reopened",
    (await statusOf(note1.id)) === "completed",
  );

  // ---- Proof 3 -------------------------------------------------------------
  console.log("\nProof 3 — concurrent double-claim yields exactly one winner");
  const before3 = geminiCalls;
  const note2 = await seedNote("notegen proof 3", TRANSCRIPT);
  const outcomes = await Promise.all([
    claimAndGenerate(ports, note2),
    claimAndGenerate(ports, note2),
  ]);

  const winners = outcomes.filter((o) => o === "generated").length;
  const losers = outcomes.filter((o) => o === "contended").length;

  check("exactly one winner", winners === 1, `(${JSON.stringify(outcomes)})`);
  check("exactly one contended loser", losers === 1, `(${JSON.stringify(outcomes)})`);
  check(
    "exactly one Gemini call across both",
    geminiCalls - before3 === 1,
    `(${geminiCalls - before3})`,
  );

  // ---- Proof 5 -------------------------------------------------------------
  console.log("\nProof 5 — a blank transcript goes terminal without a call");
  const before5 = geminiCalls;
  const note3 = await seedNote("notegen proof 5", "   \n\t  ");
  const outcome5 = await claimAndGenerate(ports, note3);

  check("outcome is 'blank'", outcome5 === "blank", `(${outcome5})`);
  check(
    "no Gemini call",
    geminiCalls - before5 === 0,
    `(${geminiCalls - before5})`,
  );
  check("row reads notegen_status = 'failed'", (await statusOf(note3.id)) === "failed");

  // ---- Proof 6 -------------------------------------------------------------
  console.log("\nProof 6 — a hand-typed title survives generation");
  // THE GUARANTEE THIS TRACK OWES. notes.title is nullable with no default, so
  // a non-null value can only have been typed by its owner, and the guarded
  // UPDATE (`is('title', null)`) must match zero rows against it. Proved
  // against the live database rather than against a fake builder chain.
  const HAND_TYPED = "Named by hand, do not overwrite";
  const note4 = await seedNote(HAND_TYPED, TRANSCRIPT);
  const outcome6 = await claimAndGenerate(ports, note4);

  check("the note still generated", outcome6 === "generated", `(${outcome6})`);
  check("row reads notegen_status = 'completed'", (await statusOf(note4.id)) === "completed");
  const title4 = await titleOf(note4.id);
  console.log(`  title after generation: ${JSON.stringify(title4)}`);
  check("the hand-typed title is unchanged", title4 === HAND_TYPED, `(${title4})`);

  console.log(`\ntotal Gemini calls across all six proofs: ${geminiCalls}`);
} finally {
  // As the OWNER, never the admin. This exercises the RLS delete path a real
  // user takes; note_chunks cascade on notes.id. Deleting as service_role
  // would succeed while proving nothing.
  for (const id of created) {
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.error(`  cleanup: could not delete ${id}: ${error.message}`);
  }
  console.log(`cleaned up ${created.length} note row(s) as the owner`);
}

console.log(failed ? "\nFAILED\n" : "\nPASSED\n");
process.exit(failed ? 1 : 0);
