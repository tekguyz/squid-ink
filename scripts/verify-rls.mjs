/**
 * Proves owner-only RLS on notes and note_chunks with two real auth users.
 *
 * PROOF PATH A — real password-grant JWT, sent as an Authorization header.
 *
 *   Both users sign in for real. Supabase's auth server issues a signed
 *   session token. That token is attached to a client built with the
 *   PUBLISHABLE key, so PostgREST verifies the signature and derives the
 *   Postgres role from the token's own claims. Nothing about the role is
 *   asserted by this script.
 *
 *   This is NOT role-injection. Role-injection would be connecting as
 *   postgres and hand-forging request.jwt.claims — that bypasses RLS and
 *   produces a false pass. To rule it out, every token is decoded and its
 *   role claim must read "authenticated" before any result is trusted.
 *
 *   The secret key is used ONLY to create the two users. Every query runs
 *   through the publishable key plus a user JWT.
 *
 * NOT COVERED HERE — PROOF PATH B: real session cookies through
 * proxy.ts into a server component. That is the app's own plumbing and
 * is verified separately in the browser. Neither path substitutes for the
 * other; report both.
 *
 * Not part of `npm test` — it needs network access and the secret key.
 * Run with: node scripts/verify-rls.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEEDED_NOTE_ID = "11111111-1111-4111-8111-111111111111";

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

/** Read the role claim without verifying — we only need to prove we are NOT
 *  running as service_role. PostgREST does the real verification. */
function roleClaim(jwt) {
  const payload = jwt.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json).role;
}

async function ensureUser(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error) return data.user.id;
  if (!/already|exists|registered/i.test(error.message)) throw error;

  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;
  const found = list.users.find((u) => u.email === email);
  if (!found) throw new Error(`${email} reported as existing but not listed`);
  return found.id;
}

/** Sign in for real, then hand the returned token to a publishable-key
 *  client. PostgREST validates it and picks the role from the token. */
async function signIn(url, publishableKey, email, password) {
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  const token = data.session.access_token;
  const role = roleClaim(token);
  if (role !== "authenticated") {
    throw new Error(
      `refusing to trust a result from role "${role}" — the proof requires ` +
        `the authenticated role, not service_role or a superuser`,
    );
  }

  return {
    email,
    userId: data.user.id,
    role,
    client: createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

const QUERIES = [
  {
    table: "notes",
    sql: `select id, title, user_id, processing_status from notes where id = '${SEEDED_NOTE_ID}'`,
    run: (c) =>
      c.from("notes").select("id, title, user_id, processing_status").eq("id", SEEDED_NOTE_ID),
  },
  {
    table: "note_chunks",
    sql: `select id, chunk_type, user_id from note_chunks where note_id = '${SEEDED_NOTE_ID}'`,
    run: (c) => c.from("note_chunks").select("id, chunk_type, user_id").eq("note_id", SEEDED_NOTE_ID),
  },
  {
    // No id filter here: the point is that each user sees only their own
    // rows of a table both users have rows in. A filter would weaken that.
    table: "personas",
    sql: "select id, slug, name, user_id from personas",
    run: (c) => c.from("personas").select("id, slug, name, user_id"),
    // The second user owns one persona of their own (created below), so a
    // wide-open select policy would show them five rows, not zero. Without
    // that row, "zero rows" would also be the answer for a table that is
    // simply empty for them, and the two are not the same proof.
    secondUserExpects: 1,
  },
];

/** Give the second user one persona of their own, through their OWN client.
 *  That exercises the insert policy and turns the select proof from "the
 *  table is empty for them" into "the table is filtered for them". */
async function ensureIntruderPersona(user) {
  const { error } = await user.client.from("personas").insert({
    user_id: user.userId,
    slug: "rls-probe",
    name: "RLS Probe",
    sub: "owned by the second user",
    sort_order: 0,
  });
  // 23505 is the unique (user_id, slug) constraint: the row is already there
  // from an earlier run, which is exactly the state we want.
  if (error && error.code !== "23505") {
    throw new Error(`second user could not insert their own persona: ${error.message}`);
  }
}

/** The composite foreign key on note_chunks must refuse a chunk that points
 *  at another user's persona. Foreign keys are validated as the referenced
 *  table's owner and are NOT subject to RLS, so a single-column
 *  references personas (id) would allow this. 23503 is the FK violation. */
async function crossTenantAttributionIsRefused(user, foreignPersonaId) {
  const noteId = "99999999-9999-4999-8999-999999999999";
  await user.client
    .from("notes")
    .insert({ id: noteId, user_id: user.userId, title: "RLS probe note" });

  const { error } = await user.client.from("note_chunks").insert({
    note_id: noteId,
    user_id: user.userId,
    chunk_type: "takeaway",
    persona_id: foreignPersonaId,
    content: "attributed to a persona this user does not own",
  });

  await user.client.from("notes").delete().eq("id", noteId);
  return { refused: Boolean(error), code: error?.code ?? null, message: error?.message ?? null };
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await ensureUser(admin, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
await ensureUser(admin, env.RLS_TEST_INTRUDER_EMAIL, env.RLS_TEST_INTRUDER_PASSWORD);

const owner = await signIn(url, publishableKey, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
const intruder = await signIn(
  url,
  publishableKey,
  env.RLS_TEST_INTRUDER_EMAIL,
  env.RLS_TEST_INTRUDER_PASSWORD,
);

await ensureIntruderPersona(intruder);

console.log("proof path : A - real password-grant JWT via Authorization header");
console.log("             (NOT session cookies through the proxy - see path B)");
console.log(`owner      : ${owner.email}  ${owner.userId}  role=${owner.role}`);
console.log(`second user: ${intruder.email}  ${intruder.userId}  role=${intruder.role}`);
console.log("");

let failed = false;

for (const query of QUERIES) {
  console.log(`--- ${query.table} ---`);
  console.log(`query: ${query.sql}`);

  const secondUserRows = query.secondUserExpects ?? 0;

  for (const [label, user, expected] of [
    ["owner   ", owner, "some"],
    ["intruder", intruder, "none"],
  ]) {
    const { data, error } = await query.run(user.client);
    const rows = data?.length ?? 0;

    console.log(
      `  ${label}  role=${user.role}  rows=${rows}  error=${error ? JSON.stringify(error.message) : "null"}`,
    );
    if (rows > 0) console.log(`             data=${JSON.stringify(data)}`);

    // An error is a failure even on the second user: "permission denied"
    // means the grant is missing, not that RLS filtered the rows.
    if (error) {
      failed = true;
      console.log("             FAIL: expected no error");
    } else if (expected === "some" && rows === 0) {
      failed = true;
      console.log("             FAIL: owner should see rows");
    } else if (expected === "none" && rows !== secondUserRows) {
      failed = true;
      console.log(`             FAIL: second user must see exactly ${secondUserRows} row(s)`);
    } else if (expected === "none" && data?.some((r) => r.user_id !== user.userId)) {
      failed = true;
      console.log("             FAIL: second user saw a row they do not own");
    }
  }
  console.log("");
}

// A separate proof from RLS: this one is the database's foreign key, not a
// policy. RLS decides what a user can READ; this decides what they can point at.
console.log("--- note_chunks.persona_id cross-tenant write ---");
const ownerPersonas = await owner.client.from("personas").select("id").limit(1);
const foreignPersonaId = ownerPersonas.data?.[0]?.id;
if (!foreignPersonaId) {
  failed = true;
  console.log("  FAIL: could not read an owner persona id to probe with");
} else {
  console.log(`attempt: second user inserts a note_chunk with persona_id = ${foreignPersonaId}`);
  const probe = await crossTenantAttributionIsRefused(intruder, foreignPersonaId);
  console.log(`  refused=${probe.refused}  code=${probe.code}  error=${JSON.stringify(probe.message)}`);
  if (!probe.refused) {
    failed = true;
    console.log("             FAIL: a user attributed a chunk to another user's persona");
  }
}
console.log("");

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
