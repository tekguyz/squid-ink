/**
 * Live proof that generation RUNS under Brief, under Exhaustive, and through
 * DEFAULT_PERSONA_FALLBACK — against the hosted project and the real Gemini
 * API.
 *
 * Why this exists: until 2026-09-26 live generation had only ever run at
 * Dense, and the fallback branch was proved for RESOLUTION only (proof 6 of
 * verify-persona-selection.mjs) because no zero-persona account owned a note.
 * Setting a depth is not the same as having generated under it (issue #14).
 *
 * It imports the SHIPPED modules, exactly as the two sibling scripts do:
 *
 *     lib/notegen/generate-note.ts    claimAndGenerate
 *     lib/notegen/notegen-ports.ts    createNotegenPorts
 *     lib/notegen/resolve-persona.ts  resolvePersonaFor
 *
 * ports.generate and ports.resolvePersona are wrapped, so the depth plan and
 * the persona source are READ OFF the real call, not inferred from inputs.
 *
 * A THROWAWAY ACCOUNT, not the RLS test owner. Brief and Exhaustive need a
 * lens set to that depth, and the fallback needs an account with no personas.
 * Doing either to the shared test owner would change what the other scripts
 * prove. So the admin creates `depth-proof@squid-ink.test`, the provisioning
 * trigger gives it four lenses, and everything after that runs as that user
 * on the authenticated (RLS) client — the depth write the way /personas makes
 * it, and the persona deletes through personas_delete_own. The admin deletes
 * the account at the end; every row cascades.
 *
 * SUPABASE_SECRET_KEY is read for exactly two calls: creating and deleting
 * that account. Nothing is read or written through it in between.
 *
 * Three proofs:
 *
 *   1. Brief: plan is low / decisions-and-actions, one Gemini call, NO
 *      summary chunk, and takeaways or action items are written.
 *   2. Exhaustive: plan is high / cross-referenced, one Gemini call, and a
 *      summary chunk is written.
 *   3. Fallback: with every persona row deleted, generation resolves
 *      source 'fallback', runs the Dense plan, and completes with chunks.
 *
 *   node scripts/verify-depth-and-fallback.mjs    # no dev server needed
 *
 * If a run dies before cleanup, sweep it:
 *   delete from auth.users where email = 'depth-proof@squid-ink.test';
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROOF_EMAIL = "depth-proof@squid-ink.test";

/** A planning call with decisions, owners and one implied follow-up — enough
 *  for Exhaustive to cross-reference and for Brief to have something to cut. */
const TRANSCRIPT = [
  "Lena: Let's settle the launch date. Marketing wants the twelfth.",
  "Omar: The twelfth works only if QA signs off on the payment flow by the eighth.",
  "Lena: Then the eighth is the gate. Omar, you own the QA sign-off.",
  "Omar: Fine. I need the test accounts from finance by Monday to hit that.",
  "Jo: I can chase finance for those accounts today.",
  "Lena: Good. And the press release — who is drafting it?",
  "Jo: I will, but I need the final pricing first.",
  "Lena: Pricing is locked at forty-nine a month. So we launch on the twelfth, gated on QA.",
].join("\n");

// ---------------------------------------------------------------------------
// Loading the shipped TypeScript
// ---------------------------------------------------------------------------

const ROOT = pathToFileURL(resolve(import.meta.dirname, "..") + "/").href;

// Map tsconfig's "@/*" onto the repo root; Node knows nothing of it.
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

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, env.SUPABASE_SECRET_KEY, clientOptions);

/** A crashed earlier run can leave the account behind. Remove it first, so
 *  the trigger provisions a fresh one and every proof starts from the same
 *  state. */
async function deleteProofAccount() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listing users failed: ${error.message}`);
  const stale = data.users.find((u) => u.email === PROOF_EMAIL);
  if (!stale) return false;
  const { error: delError } = await admin.auth.admin.deleteUser(stale.id);
  if (delError) throw new Error(`deleting ${PROOF_EMAIL} failed: ${delError.message}`);
  return true;
}

if (await deleteProofAccount()) console.log(`removed a stale ${PROOF_EMAIL}`);

// The project's password policy wants all four character classes; base64url
// alone can miss one, so a fixed suffix guarantees them.
const password = `${randomBytes(24).toString("base64url")}aA1!`;
const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
  email: PROOF_EMAIL,
  password,
  email_confirm: true,
});
if (createError) throw new Error(`creating ${PROOF_EMAIL} failed: ${createError.message}`);
const userId = createdUser.user.id;

let geminiCalls = 0;
let lastPlan = null;
let lastSource = null;

try {
  const anon = createClient(url, publishableKey, clientOptions);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email: PROOF_EMAIL,
    password,
  });
  if (signInError) throw signInError;

  const token = signIn.session.access_token;
  const role = roleClaim(token);
  if (role !== "authenticated") {
    throw new Error(`refusing to trust a result from role "${role}"`);
  }

  const owner = createClient(url, publishableKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Both wrappers only observe. The real call happens either way.
  const realPorts = createNotegenPorts(owner, env.GEMINI_API_KEY);
  const ports = {
    ...realPorts,
    resolvePersona: async (...args) => {
      const persona = await realPorts.resolvePersona(...args);
      lastSource = persona.source;
      return persona;
    },
    generate: async (request) => {
      geminiCalls += 1;
      lastPlan = request.plan;
      return realPorts.generate(request);
    },
  };

  async function personaCount() {
    const { data, error } = await owner.from("personas").select("id");
    if (error) throw new Error(`reading personas failed: ${error.message}`);
    return data.length;
  }

  /** The /personas depth write: RLS scopes it, so no user_id filter. */
  async function setDepth(slug, depth) {
    const { data, error } = await owner
      .from("personas")
      .update({ depth })
      .eq("slug", slug)
      .select("id, depth")
      .single();
    if (error) throw new Error(`setting ${slug} to ${depth} failed: ${error.message}`);
    return data;
  }

  /** Seed a completed note and run the shipped claim-and-generate on it.
   *  Returns the outcome, the Gemini calls it spent, and its chunks. */
  async function generate(title, personaId) {
    const { data: note, error } = await owner
      .from("notes")
      .insert({
        user_id: userId,
        title,
        processing_status: "completed",
        raw_transcript: TRANSCRIPT,
        notegen_status: null,
        persona_id: personaId,
      })
      .select("id, user_id, raw_transcript, updated_at")
      .single();
    if (error) throw new Error(`seeding "${title}" failed: ${error.message}`);

    lastPlan = null;
    lastSource = null;
    const before = geminiCalls;
    const outcome = await claimAndGenerate(ports, note);

    const { data: chunks } = await owner
      .from("note_chunks")
      .select("chunk_type, content")
      .eq("note_id", note.id)
      .order("chunk_type");
    return { outcome, calls: geminiCalls - before, chunks: chunks ?? [] };
  }

  function printChunks(heading, chunks) {
    console.log(`\n      ---- ${heading} ----`);
    for (const c of chunks) console.log(`      [${c.chunk_type}] ${c.content}`);
    console.log("      " + "-".repeat(heading.length + 10));
  }

  const count = (chunks, type) => chunks.filter((c) => c.chunk_type === type).length;

  console.log(`\nsigned in as ${PROOF_EMAIL} (${userId}), role ${role}`);
  check("the provisioning trigger gave it four lenses", (await personaCount()) === 4);

  // --- Proof 1: Brief --------------------------------------------------------
  console.log("\n1. a note generates under Brief");
  {
    const lens = await setDepth(DEFAULT_PERSONA_ID, "brief");
    check("the lens now reads brief", lens.depth === "brief");

    const r = await generate("depth proof — brief", lens.id);
    check("generated", r.outcome === "generated", r.outcome);
    check("exactly one Gemini call", r.calls === 1, `${r.calls}`);
    check("the persona came from the note", lastSource === "note", lastSource);
    check(
      "the call ran the Brief plan",
      lastPlan?.thinkingLevel === "low" && lastPlan?.scope === "decisions-and-actions",
      `${lastPlan?.thinkingLevel}/${lastPlan?.scope}`,
    );
    check("no summary chunk", count(r.chunks, "summary") === 0);
    check(
      "takeaways or action items were written",
      count(r.chunks, "takeaway") + count(r.chunks, "action_item") > 0,
      `${r.chunks.length} rows`,
    );
    printChunks("GENERATED UNDER BRIEF", r.chunks);
  }

  // --- Proof 2: Exhaustive ---------------------------------------------------
  console.log("\n2. a note generates under Exhaustive");
  {
    const lens = await setDepth(DEFAULT_PERSONA_ID, "exhaustive");
    check("the lens now reads exhaustive", lens.depth === "exhaustive");

    const r = await generate("depth proof — exhaustive", lens.id);
    check("generated", r.outcome === "generated", r.outcome);
    check("exactly one Gemini call", r.calls === 1, `${r.calls}`);
    check(
      "the call ran the Exhaustive plan",
      lastPlan?.thinkingLevel === "high" && lastPlan?.scope === "cross-referenced",
      `${lastPlan?.thinkingLevel}/${lastPlan?.scope}`,
    );
    check("a summary chunk was written", count(r.chunks, "summary") === 1);
    printChunks("GENERATED UNDER EXHAUSTIVE", r.chunks);
  }

  // --- Proof 3: generation through DEFAULT_PERSONA_FALLBACK ------------------
  console.log("\n3. an account with no personas generates through the fallback");
  {
    // Through personas_delete_own, as the owner — the state an account made
    // before the 2026-08-31 provisioning trigger is in.
    const { error } = await owner.from("personas").delete().not("id", "is", null);
    if (error) throw new Error(`deleting personas failed: ${error.message}`);
    check("the account now owns zero personas", (await personaCount()) === 0);

    const resolved = await resolvePersonaFor(owner, userId, null);
    check("resolution reports fallback", resolved.source === "fallback", resolved.source);

    const r = await generate("depth proof — fallback", null);
    check("generated", r.outcome === "generated", r.outcome);
    check("exactly one Gemini call", r.calls === 1, `${r.calls}`);
    check("the generation itself used the fallback", lastSource === "fallback", lastSource);
    check(
      "the call ran the fallback's Dense plan",
      lastPlan?.thinkingLevel === "medium" && lastPlan?.scope === "balanced",
      `${lastPlan?.thinkingLevel}/${lastPlan?.scope}`,
    );
    check("chunks were written", r.chunks.length > 0, `${r.chunks.length} rows`);
    printChunks("GENERATED THROUGH THE FALLBACK", r.chunks);
  }

  console.log(`\ntotal Gemini calls: ${geminiCalls}`);
} finally {
  // Deleting the account cascades its notes, chunks and any personas left.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.log(`  cleanup FAILED: ${error.message} — sweep ${PROOF_EMAIL} by hand`);
    failed = true;
  } else {
    console.log(`deleted ${PROOF_EMAIL} and everything it owned`);
  }
}

console.log(failed ? "\nFAILED\n" : "\nALL PROOFS PASSED\n");
process.exit(failed ? 1 : 0);
