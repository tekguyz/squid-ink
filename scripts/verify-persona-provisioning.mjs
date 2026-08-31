/**
 * Proves that a brand-new auth account is provisioned with the four default
 * personas by the database, with no application code involved.
 *
 * WHAT IS UNDER TEST
 *
 *   public.provision_default_personas(), a security definer function, and the
 *   after-insert trigger on auth.users that calls it. Both ship in
 *   supabase/schemas/persona_provisioning.sql.
 *
 * THE TWO READ PATHS, AND WHY NEITHER IS service_role
 *
 *   supabase/schemas/personas.sql revokes all and then grants only
 *   `authenticated`. service_role is never granted anything on the table, and
 *   this project was created with "automatically expose new tables" off, so it
 *   holds no SELECT — a secret-key read of public.personas comes back
 *   "permission denied for table personas". service_role bypasses RLS; it does
 *   not bypass grants. That is the intended shape and this script does not
 *   widen it.
 *
 *   So the rows are read twice, neither time as service_role:
 *
 *     1. Raw table truth, through `supabase db query --linked`, which runs as
 *        postgres. This is what proves the trigger wrote four rows, and it is
 *        the only path that can still read after the account is deleted.
 *     2. The app-visible read: the probe account signs in for real with the
 *        PUBLISHABLE key and selects its own personas as `authenticated`,
 *        under RLS. This is what proves a new signup actually sees four
 *        lenses rather than four rows merely existing.
 *
 *   The secret key is used ONLY to create and delete the probe account.
 *
 * CLEANUP
 *
 *   The account is created AND deleted through the admin API, the delete in a
 *   finally block, so a failed assertion still cleans up. No orphaned test
 *   users, no dashboard step.
 *
 * WHAT IS NOT COVERED
 *
 *   Existing accounts. The trigger fires on INSERT only and deliberately does
 *   not backfill; the before/after counts below are what proves that.
 *   Owner-only RLS on personas is proved by scripts/verify-rls.mjs, not here.
 *
 * Not part of `npm test` — it needs network access and the secret key.
 * Run with: node scripts/verify-persona-provisioning.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/** Copied verbatim from supabase/schemas/persona_provisioning.sql, which in
 *  turn copied them from supabase/seed.sql. If these ever disagree, the
 *  schema file is the source of truth and this array is the follower. */
const EXPECTED = [
  {
    slug: "neutral-analyst",
    name: "Neutral Analyst",
    sub: "dense · no framing",
    depth: "dense",
    quick_actions: [
      "Extract decisions only",
      "Timeline of blockers",
      "Unanswered questions",
      "Diff against last call",
    ],
    sort_order: 0,
  },
  {
    slug: "sales-coach",
    name: "Sales Coach",
    sub: "coaching · direct",
    depth: "dense",
    quick_actions: [
      "Score objection handling",
      "Draft follow-up email",
      "Next-call agenda",
      "Concessions made",
    ],
    sort_order: 1,
  },
  {
    slug: "investor",
    name: "Investor",
    sub: "economics · risk",
    depth: "dense",
    quick_actions: [
      "Unit-economics read",
      "Expansion risk memo",
      "Diligence questions",
      "Quantified risks",
    ],
    sort_order: 2,
  },
  {
    slug: "engineering-lead",
    name: "Engineering Lead",
    sub: "scope · sequencing",
    depth: "dense",
    quick_actions: [
      "Scope the mapping work",
      "Risk register entry",
      "Sequencing plan",
      "Handoff brief",
    ],
    sort_order: 3,
  },
];

/** Same loader as scripts/verify-rls.mjs. Copied rather than imported: that
 *  file is a top-level script with side effects, so importing it would run
 *  the whole RLS proof as a side effect of reading one helper. */
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

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY;
const projectRef = new URL(url).hostname.split(".")[0];

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Read path 1: the linked project's database through the management API,
 *  which runs as postgres. The CLI prints a JSON object plus incidental
 *  lines (login notices, upgrade nags), so the object is sliced out by
 *  brace rather than parsed off the whole stream. */
function dbQuery(sql) {
  // execSync with one command string, not execFileSync with an args array.
  // The CLI is a .cmd shim on Windows, which node 24 refuses to spawn without
  // a shell (EINVAL), and execFileSync with an args array PLUS shell:true is
  // what node deprecated in DEP0190 — it concatenates without escaping. One
  // string means the quoting is explicit and visible. Every query in this file
  // is a literal built here and uses single quotes only, so wrapping in double
  // quotes is sufficient; nothing user-supplied reaches this.
  if (sql.includes('"')) throw new Error("dbQuery cannot pass a double quote through the shell");
  const stdout = execSync(
    `npx supabase db query --linked --project-ref ${projectRef} "${sql}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`db query returned no JSON object:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start, end + 1)).rows;
}

const PERSONA_COLUMNS = "id, user_id, slug, name, sub, depth, quick_actions, sort_order";

function personaRows(userId) {
  return dbQuery(
    `select ${PERSONA_COLUMNS} from public.personas where user_id = '${userId}' order by sort_order`,
  );
}

function personaCount(userId) {
  return personaRows(userId).length;
}

/** Read path 2: a real password grant, exactly as scripts/verify-rls.mjs does
 *  it. The token is handed to a PUBLISHABLE-key client, so PostgREST derives
 *  the role from the token's own claims rather than from anything this script
 *  asserts. The role claim is checked so a service_role token could never be
 *  mistaken for proof. */
async function readOwnPersonasAsUser(email, password) {
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  const token = data.session.access_token;
  const role = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ).role;
  if (role !== "authenticated") {
    throw new Error(`refusing to trust a result from role "${role}"`);
  }

  const user = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await user.from("personas").select(PERSONA_COLUMNS).order("sort_order");
  if (result.error) throw new Error(`${email} could not read personas: ${result.error.message}`);
  return { role, rows: result.data };
}

/** The accounts that must be untouched: the seed owner (which is also the RLS
 *  fixture owner — one account, two roles) and the RLS fixture second user. */
const UNTOUCHED_EMAILS = [env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_INTRUDER_EMAIL].filter(Boolean);

/** Resolve emails to ids once, so the counts below cannot silently follow a
 *  recreated account that happens to reuse the address. */
async function resolveUsers(emails) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return emails.map((email) => {
    const found = data.users.find((u) => u.email === email);
    if (!found) throw new Error(`${email} is not an account on this project`);
    return { email, id: found.id };
  });
}

let failed = false;
function check(condition, passMessage, failMessage) {
  if (condition) {
    console.log(`  PASS: ${passMessage}`);
  } else {
    failed = true;
    console.log(`  FAIL: ${failMessage}`);
  }
}

console.log("under test : public.provision_default_personas() + the after-insert");
console.log("             trigger on auth.users");
console.log("read path 1: supabase db query --linked, running as postgres - raw");
console.log("             table truth, and the only path that survives the delete");
console.log("read path 2: the probe account's own password grant, role=authenticated,");
console.log("             under RLS - what a new signup actually sees");
console.log("not used   : a service_role read. personas.sql grants only");
console.log("             authenticated, so the secret key holds no SELECT here.");
console.log("");

const untouched = await resolveUsers(UNTOUCHED_EMAILS);

console.log("--- existing accounts, BEFORE ---");
const before = untouched.map((user) => {
  const count = personaCount(user.id);
  console.log(`  ${user.email}  ${user.id}  personas=${count}`);
  return count;
});
console.log("");

// A fresh address every run, so this can never collide with a leftover
// account and can never be mistaken for one of the fixtures.
const stamp = Date.now();
const probeEmail = `provisioning-probe-${stamp}@example.test`;
const probePassword = `probe-${stamp}-${Math.random().toString(36).slice(2)}`;
let probeId = null;

try {
  console.log("--- signup ---");
  console.log(`  creating ${probeEmail} through the admin API`);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: probeEmail,
    password: probePassword,
    email_confirm: true,
  });
  if (createError) throw new Error(`admin createUser failed: ${createError.message}`);
  probeId = created.user.id;
  console.log(`  created  ${probeId}`);
  console.log("");

  console.log("--- read path 1: personas provisioned for the new account ---");
  const rows = personaRows(probeId);
  for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
  console.log("");

  check(
    rows.length === 4,
    "exactly 4 persona rows exist for the new account",
    `expected 4 persona rows, got ${rows.length}`,
  );

  if (rows.length === 4) {
    for (const [i, expected] of EXPECTED.entries()) {
      const row = rows[i];
      // quick_actions is compared with JSON.stringify, which is order
      // sensitive: rail order is part of the contract, not incidental.
      const matches =
        row.slug === expected.slug &&
        row.name === expected.name &&
        row.sub === expected.sub &&
        row.depth === expected.depth &&
        row.sort_order === expected.sort_order &&
        JSON.stringify(row.quick_actions) === JSON.stringify(expected.quick_actions);
      check(
        matches,
        `row ${i} matches the seed exactly (${expected.slug})`,
        `row ${i} differs from the seed\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(row)}`,
      );
    }
  }

  check(
    rows.every((r) => r.user_id === probeId),
    "every row is owned by the new account",
    "a provisioned row is owned by someone other than the new account",
  );
  console.log("");

  console.log("--- read path 2: the new account reads its own personas ---");
  const seen = await readOwnPersonasAsUser(probeEmail, probePassword);
  console.log(`  role=${seen.role}  rows=${seen.rows.length}`);
  console.log(`  slugs=${JSON.stringify(seen.rows.map((r) => r.slug))}`);
  check(
    seen.rows.length === 4,
    "a brand-new signup sees all 4 lenses through RLS, not the 1-lens fallback",
    `a brand-new signup sees ${seen.rows.length} lenses, not 4`,
  );
  check(
    JSON.stringify(seen.rows.map((r) => r.slug)) ===
      JSON.stringify(EXPECTED.map((e) => e.slug)),
    "the lenses arrive in rail order",
    "the lenses did not arrive in rail order",
  );
  console.log("");
} finally {
  if (probeId) {
    console.log("--- cleanup ---");
    const { error: deleteError } = await admin.auth.admin.deleteUser(probeId);
    check(
      !deleteError,
      `deleted ${probeEmail}`,
      `could not delete ${probeEmail}: ${deleteError?.message}`,
    );

    const remaining = personaCount(probeId);
    // Zero here is also the on delete cascade on personas.user_id doing its
    // job: nothing in this script deletes a persona row directly.
    check(
      remaining === 0,
      `0 persona rows remain for ${probeId} (on delete cascade)`,
      `${remaining} persona rows survived the account delete`,
    );
    console.log("");
  }
}

console.log("--- existing accounts, AFTER ---");
untouched.forEach((user, i) => {
  const count = personaCount(user.id);
  console.log(`  ${user.email}  ${user.id}  personas=${count}`);
  check(
    count === before[i],
    `${user.email} unchanged at ${before[i]}`,
    `${user.email} moved from ${before[i]} to ${count} - the trigger touched an existing account`,
  );
});
console.log("");

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
