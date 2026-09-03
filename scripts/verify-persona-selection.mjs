/**
 * Live proof of PER-NOTE LENS SELECTION against the hosted project and the
 * real Gemini API.
 *
 * The claim being made is "the lens shown on Note Detail is the lens that
 * generated the note", so this script imports the SHIPPED functions rather
 * than re-implementing them:
 *
 *     app/notes/actions/persona.ts    the guarded write (via its own SQL shape)
 *     lib/notegen/generate-note.ts    claimAndGenerate
 *     lib/notegen/notegen-ports.ts    createNotegenPorts
 *     lib/notegen/resolve-persona.ts  resolvePersonaFor
 *
 * Node 24 strips TypeScript natively and the resolve hook below maps this
 * project's "@/" alias onto the repo root, so these are the real modules. A
 * copy in this file would only prove that the copy agrees with itself.
 *
 * WHY THE SERVER ACTION ITSELF IS NOT IMPORTED. app/notes/actions/persona.ts
 * carries "use server" and imports lib/supabase/server.ts, which reads
 * next/headers — there is no request scope in a plain Node process, so the
 * module cannot load outside the framework. What matters is reproduced
 * exactly: the same guarded UPDATE, against the same authenticated client,
 * with the same clauses. Proof 3 is what makes that guard real rather than
 * asserted, and the browser check in docs covers the action end to end.
 *
 * ports.generate is wrapped in a counter, so "the lens was used" is measured
 * against a real call rather than inferred.
 *
 * Five proofs:
 *
 *   1. A fresh note seeds its lens to the remembered slug, and the value in
 *      the database matches what the rail would highlight — before any click.
 *   2. Selecting a different lens writes it, and the remembered preference
 *      moves with it. Both read back from the database.
 *   3. The guarded write is REFUSED once the note is frozen — zero rows, with
 *      notegen_status set and again with processing_status past 'uploading'.
 *      This is what makes the lock enforcement rather than a disabled button.
 *   4. A note set to sales-coach generates under the Sales Coach framing, and
 *      the generated content is PRINTED IN FULL. A row count would not prove
 *      the lens was used.
 *   5. A note with persona_id null generates exactly as before, resolving via
 *      the neutral-analyst slug and reporting source 'row'.
 *
 * Runs against the authenticated (RLS) client throughout, which is what the
 * Server Action uses. It needs NO dev server.
 *
 *   node scripts/verify-persona-selection.mjs
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

/** A sales call, deliberately. It carries an objection, a concession and a
 *  commitment — the three things lib/notegen/lens-prompts.ts tells the Sales
 *  Coach lens to attend to, and things a Neutral Analyst reading would report
 *  without coaching on. That contrast is what makes Proof 4 readable. */
const TRANSCRIPT = [
  "Rep: Thanks for making time. Last we spoke you were weighing us against Contoso.",
  "Buyer: We were. Honestly the price is the sticking point. You're about thirty percent over them.",
  "Rep: I hear you. I can probably do fifteen percent off if we sign this quarter.",
  "Buyer: That helps. But I'd need to see the migration story before I take anything to my board.",
  "Rep: Totally fair. I'll send the migration deck tonight.",
  "Buyer: If the migration looks clean, I can get you an answer by the fifteenth.",
  "Rep: Great. And just so I plan — who else signs off besides you?",
  "Buyer: Finance has to approve anything over fifty thousand. That's Marta.",
  "Rep: Understood. I'll put together something Marta can read on its own.",
  "Buyer: Appreciate it. Send the deck and we'll talk next week.",
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

const { createNotegenPorts } = await import(
  new URL("lib/notegen/notegen-ports.ts", ROOT).href
);
const { resolvePersonaFor } = await import(
  new URL("lib/notegen/resolve-persona.ts", ROOT).href
);
const { claimAndGenerate } = await import(
  new URL("lib/notegen/generate-note.ts", ROOT).href
);
const { DEFAULT_PERSONA_ID } = await import(
  new URL("lib/notes/default-persona.ts", ROOT).href
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

/** 4tekguyz@gmail.com — created before the 2026-08-31 provisioning trigger and
 *  deliberately NOT backfilled, so it owns zero personas rows. That is what
 *  makes it the only account able to exercise DEFAULT_PERSONA_FALLBACK for
 *  real. Proof 6 re-checks the zero count before trusting the result, so this
 *  constant going stale fails loudly rather than passing for the wrong reason.
 *  Read back from auth.users on 2026-09-02. */
const ZERO_PERSONA_USER_ID = "8c9b5bfd-1046-4c74-9bf6-7c50ca55723a";

for (const name of [
  "GEMINI_API_KEY",
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

const role = roleClaim(signIn.session.access_token);
if (role !== "authenticated") {
  throw new Error(
    `refusing to trust a result from role "${role}" — the Server Action runs ` +
      `as the signed-in user, so the proof requires the authenticated role`,
  );
}

const owner = createClient(url, publishableKey, {
  global: {
    headers: { Authorization: `Bearer ${signIn.session.access_token}` },
  },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;

// The counter proves a real model call happened behind Proof 4's text.
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

// ---------------------------------------------------------------------------
// The shipped write, reproduced clause for clause
// ---------------------------------------------------------------------------

/** THE guarded write from app/notes/actions/persona.ts, same clauses, same
 *  authenticated client. Returns whether it matched.
 *
 *  Kept beside the action rather than imported for the reason in the header:
 *  "use server" plus next/headers cannot load outside a request scope. If the
 *  action's clauses ever change and this does not, Proof 3 stops matching the
 *  shipped behaviour — so treat a Proof 3 failure as "read persona.ts" first. */
async function writePersona(noteId, personaId, onlyWhenUnset) {
  let query = owner
    .from("notes")
    .update({ persona_id: personaId })
    .eq("id", noteId)
    .in("processing_status", ["local", "uploading"])
    .is("notegen_status", null);

  if (onlyWhenUnset) query = query.is("persona_id", null);

  const { data, error } = await query.select("id");
  if (error) throw new Error(`guarded write failed: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

async function personaIdForSlug(slug) {
  const { data, error } = await owner
    .from("personas")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`persona lookup failed: ${error.message}`);
  return data?.id ?? null;
}

async function slugForPersonaId(personaId) {
  if (!personaId) return null;
  const { data } = await owner
    .from("personas")
    .select("slug")
    .eq("id", personaId)
    .maybeSingle();
  return data?.slug ?? null;
}

/** A note in the state the recorder leaves it: uploading, no lens. */
async function seedNote(title, overrides = {}) {
  const { data, error } = await owner
    .from("notes")
    .insert({
      user_id: userId,
      title,
      processing_status: "uploading",
      notegen_status: null,
      persona_id: null,
      ...overrides,
    })
    .select("id, user_id, persona_id, raw_transcript, updated_at")
    .single();

  if (error) throw new Error(`seeding "${title}" failed: ${error.message}`);
  created.push(data.id);
  return data;
}

async function noteRow(noteId) {
  const { data } = await owner
    .from("notes")
    .select("id, user_id, persona_id, notegen_status, processing_status, raw_transcript, updated_at")
    .eq("id", noteId)
    .maybeSingle();
  return data;
}

async function chunksOf(noteId) {
  const { data } = await owner
    .from("note_chunks")
    .select("chunk_type, content, persona_id, metadata")
    .eq("note_id", noteId)
    .order("chunk_type");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

try {
  console.log(`\nsigned in as ${env.RLS_TEST_OWNER_EMAIL} (${userId}), role ${role}\n`);

  const salesCoachId = await personaIdForSlug("sales-coach");
  const neutralId = await personaIdForSlug(DEFAULT_PERSONA_ID);
  console.log(`  sales-coach     ${salesCoachId}`);
  console.log(`  ${DEFAULT_PERSONA_ID}  ${neutralId}\n`);

  if (!salesCoachId || !neutralId) {
    throw new Error(
      "this account needs its four provisioned personas for these proofs",
    );
  }

  // --- Proof 1: seeding on mount is a real write --------------------------
  console.log("1. a fresh note seeds its lens, and the database agrees");
  {
    // What seedNotePersona does: read the remembered slug, fall back to the
    // default, resolve it, write it behind the guard.
    const remembered = signIn.user.user_metadata?.last_persona_id;
    const slug = typeof remembered === "string" ? remembered : DEFAULT_PERSONA_ID;
    const resolved = (await personaIdForSlug(slug)) ?? neutralId;

    const note = await seedNote("persona proof — seeding");
    check("starts with no lens", note.persona_id === null, `persona_id=${note.persona_id}`);

    const wrote = await writePersona(note.id, resolved, true);
    check("the seed write lands", wrote === true);

    const after = await noteRow(note.id);
    const storedSlug = await slugForPersonaId(after.persona_id);
    check(
      "the stored lens is what the rail would highlight",
      storedSlug === slug,
      `db=${storedSlug} rail=${slug}`,
    );
    console.log(`      remembered=${remembered ?? "(none)"} → seeded ${storedSlug} (${after.persona_id})`);

    // Seeding must never overwrite: a second seed on the same row matches
    // nothing, because persona_id is no longer null.
    const again = await writePersona(note.id, salesCoachId, true);
    check("a second seed cannot overwrite the first", again === false);
  }

  // --- Proof 2: selection writes, and moves the preference -----------------
  console.log("\n2. selecting a lens writes it, and is remembered");
  {
    const note = await seedNote("persona proof — selection");
    await writePersona(note.id, neutralId, true);

    const wrote = await writePersona(note.id, salesCoachId, false);
    check("the selection write lands", wrote === true);

    const after = await noteRow(note.id);
    check(
      "the note now carries sales-coach",
      after.persona_id === salesCoachId,
      await slugForPersonaId(after.persona_id),
    );

    // THROUGH `anon`, NOT `owner`. Both speak for the same user, but only
    // `anon` actually signed in, so only it holds a session object.
    // `owner` is built from an Authorization header, which PostgREST honours
    // and GoTrue's session-bound methods do not — updateUser on it answers
    // "Auth session missing!". The shipped action has no such split: it runs
    // on the cookie client, which has a real session.
    const { error: prefError } = await anon.auth.updateUser({
      data: { last_persona_id: "sales-coach" },
    });
    check("the preference write succeeds", !prefError, prefError?.message);

    const { data: me } = await anon.auth.getUser();
    check(
      "the preference is a SLUG, not a uuid",
      me.user.user_metadata.last_persona_id === "sales-coach",
      `last_persona_id=${me.user.user_metadata.last_persona_id}`,
    );
  }

  // --- Proof 3: the guard refuses a frozen note ---------------------------
  console.log("\n3. the guarded write is refused once the lens is frozen");
  {
    // (a) frozen by notegen_status
    const a = await seedNote("persona proof — frozen by notegen");
    await owner.from("notes").update({ notegen_status: "completed" }).eq("id", a.id);
    const wroteA = await writePersona(a.id, salesCoachId, false);
    check("notegen_status set → zero rows", wroteA === false);
    check(
      "and the lens really did not move",
      (await noteRow(a.id)).persona_id === null,
    );

    // (b) frozen by processing_status alone — notegen_status still null.
    // THIS is the window the original spec left open: minutes long, because
    // note generation only claims after transcription finishes.
    const b = await seedNote("persona proof — frozen by transcribe");
    await owner.from("notes").update({ processing_status: "analyzing" }).eq("id", b.id);
    const frozen = await noteRow(b.id);
    check(
      "the window really has notegen_status null",
      frozen.notegen_status === null,
      `processing_status=${frozen.processing_status}`,
    );
    const wroteB = await writePersona(b.id, salesCoachId, false);
    check("Transcribe pressed → zero rows", wroteB === false);
    check(
      "and the lens really did not move",
      (await noteRow(b.id)).persona_id === null,
    );
  }

  // --- Proof 4: Sales Coach genuinely frames the generation ---------------
  console.log("\n4. a note set to sales-coach generates under that framing");
  {
    const note = await seedNote("persona proof — sales coach", {
      processing_status: "completed",
      raw_transcript: TRANSCRIPT,
      persona_id: salesCoachId,
    });

    const resolved = await resolvePersonaFor(owner, userId, salesCoachId);
    check(
      "resolution reports source 'note'",
      resolved.source === "note",
      `slug=${resolved.slug} name=${resolved.name} depth=${resolved.depth} source=${resolved.source}`,
    );

    const before = geminiCalls;
    const outcome = await claimAndGenerate(ports, {
      id: note.id,
      user_id: note.user_id,
      raw_transcript: TRANSCRIPT,
      updated_at: note.updated_at,
    });
    check("generated", outcome === "generated", outcome);
    check("exactly one Gemini call", geminiCalls - before === 1, `${geminiCalls - before}`);

    const rows = await chunksOf(note.id);
    check("chunks were written", rows.length > 0, `${rows.length} rows`);
    check(
      "every generated chunk carries persona_id null, as designed",
      rows.every((r) => r.persona_id === null),
    );

    console.log("\n      ---- GENERATED UNDER SALES COACH ----");
    for (const row of rows) {
      console.log(`      [${row.chunk_type}] ${row.content}`);
    }
    console.log("      -------------------------------------");
  }

  // --- Proof 5: a null lens generates exactly as before --------------------
  console.log("\n5. a note with no lens generates exactly as it did before");
  {
    const note = await seedNote("persona proof — null lens", {
      processing_status: "completed",
      raw_transcript: TRANSCRIPT,
      persona_id: null,
    });

    const resolved = await resolvePersonaFor(owner, userId, null);
    check(
      "resolution falls to the neutral-analyst slug",
      resolved.slug === DEFAULT_PERSONA_ID,
      `slug=${resolved.slug} source=${resolved.source}`,
    );

    const before = geminiCalls;
    const outcome = await claimAndGenerate(ports, {
      id: note.id,
      user_id: note.user_id,
      raw_transcript: TRANSCRIPT,
      updated_at: note.updated_at,
    });
    check("generated", outcome === "generated", outcome);
    check("exactly one Gemini call", geminiCalls - before === 1, `${geminiCalls - before}`);

    const rows = await chunksOf(note.id);
    console.log("\n      ---- GENERATED UNDER THE DEFAULT LENS ----");
    for (const row of rows) {
      console.log(`      [${row.chunk_type}] ${row.content}`);
    }
    console.log("      -----------------------------------------");
  }

  // --- Proof 6: the zero-persona account is untouched ---------------------
  console.log("\n6. an account with no personas still resolves to the fallback");
  {
    // THE ONE PROOF THAT NEEDS service_role, and only to read across accounts.
    // docs/KNOWN_GAPS.md recorded on 2026-09-02 that the
    // DEFAULT_PERSONA_FALLBACK branch was unit-tested only, because the
    // signed-in test owner is provisioned and always reports source='row'.
    // Reading as the admin is how that branch gets exercised against a real
    // zero-row account — and it is also how the CRON reaches it in production,
    // so this is the true path rather than a contrivance.
    //
    // Skipped rather than failed without the key: this script's other five
    // proofs need no secret, and demanding one would make them unrunnable for
    // no reason.
    if (!env.SUPABASE_SECRET_KEY) {
      console.log("  skip  SUPABASE_SECRET_KEY not set — cannot read across accounts");
    } else {
      const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: barren } = await admin
        .from("personas")
        .select("user_id")
        .eq("user_id", ZERO_PERSONA_USER_ID);
      check(
        "the account really owns zero personas",
        (barren?.length ?? 0) === 0,
        `${barren?.length ?? 0} rows`,
      );

      const resolved = await resolvePersonaFor(admin, ZERO_PERSONA_USER_ID, null);
      check(
        "a null lens reaches DEFAULT_PERSONA_FALLBACK",
        resolved.source === "fallback",
        `slug=${resolved.slug} name=${resolved.name} depth=${resolved.depth} source=${resolved.source}`,
      );

      // The new branch must not change this. A persona_id that resolves to
      // nothing falls THROUGH to the same fallback rather than throwing.
      const stray = await resolvePersonaFor(
        admin,
        ZERO_PERSONA_USER_ID,
        salesCoachId,
      );
      check(
        "another account's lens id falls through to the same fallback",
        stray.source === "fallback",
        `source=${stray.source}`,
      );
    }
  }

  console.log(`\ntotal Gemini calls: ${geminiCalls}`);
} finally {
  // As the OWNER, which exercises the RLS delete path a real user takes.
  for (const id of created) {
    const { error } = await owner.from("notes").delete().eq("id", id);
    if (error) console.log(`  cleanup FAILED for ${id}: ${error.message}`);
  }
  console.log(`cleaned up ${created.length} note(s)`);
}

console.log(failed ? "\nFAILED\n" : "\nALL PROOFS PASSED\n");
process.exit(failed ? 1 : 0);
