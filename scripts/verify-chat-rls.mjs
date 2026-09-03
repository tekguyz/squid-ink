/**
 * Proves owner-only RLS on chat_messages with two real auth users, and proves
 * the citation floor that lib/../parse-citations.ts depends on.
 *
 * PROOF PATH A — real password-grant JWT, sent as an Authorization header.
 * Identical mechanism to scripts/verify-rls.mjs: both users sign in for real,
 * Supabase's auth server issues a signed session token, and that token is
 * attached to a client built with the PUBLISHABLE key. PostgREST verifies the
 * signature and derives the Postgres role from the token's own claims.
 *
 * Every token's role claim is decoded and must read "authenticated" before any
 * result is trusted. That is what rules out the false pass: a service_role
 * client bypasses RLS entirely and would report success while proving nothing.
 * The secret key is used ONLY to create the two users.
 *
 * NOT COVERED HERE — PROOF PATH B: real session cookies through proxy.ts into
 * a route handler. That is the app's own plumbing, verified in the browser.
 * Neither path substitutes for the other; report both.
 *
 * Not part of `npm test` — it needs network access and the secret key.
 * Run with: node scripts/verify-chat-rls.mjs
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

/** Read the role claim without verifying — we only need to prove we are NOT
 *  running as service_role. PostgREST does the real verification. */
function roleClaim(jwt) {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
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

async function signIn(url, publishableKey, email, password) {
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
  });
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

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await ensureUser(admin, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
await ensureUser(
  admin,
  env.RLS_TEST_INTRUDER_EMAIL,
  env.RLS_TEST_INTRUDER_PASSWORD,
);

const owner = await signIn(
  url,
  publishableKey,
  env.RLS_TEST_OWNER_EMAIL,
  env.RLS_TEST_OWNER_PASSWORD,
);
const intruder = await signIn(
  url,
  publishableKey,
  env.RLS_TEST_INTRUDER_EMAIL,
  env.RLS_TEST_INTRUDER_PASSWORD,
);

console.log("proof path : A - real password-grant JWT via Authorization header");
console.log("             (NOT session cookies through the proxy - see path B)");
console.log(`owner      : ${owner.email}  ${owner.userId}  role=${owner.role}`);
console.log(
  `second user: ${intruder.email}  ${intruder.userId}  role=${intruder.role}`,
);
console.log("");

let failed = false;
const fail = (message) => {
  failed = true;
  console.log(`             FAIL: ${message}`);
};

// The page the conversation happens on, and a SECOND note that a citation
// points at. They must be different rows: chat_messages.note_id cascades, so
// citing the page's own note would delete the message along with the note and
// prove nothing about a dangling citation.
const pageNoteId = crypto.randomUUID();
const citedNoteId = crypto.randomUUID();
const chatIds = [];

async function cleanup() {
  for (const id of chatIds) {
    await owner.client.from("chat_messages").delete().eq("id", id);
  }
  // Deleted as the OWNER, not the admin. service_role bypasses RLS and would
  // silently succeed while proving nothing about the delete policy.
  for (const id of [pageNoteId, citedNoteId]) {
    await owner.client.from("notes").delete().eq("id", id);
  }
}

try {
  // ---------------------------------------------------------------- proof 1
  console.log("--- proof 1: the owner can write and read their own turns ---");
  for (const [id, title] of [
    [pageNoteId, "chat RLS probe - the page"],
    [citedNoteId, "chat RLS probe - the cited note"],
  ]) {
    const { error } = await owner.client
      .from("notes")
      .insert({ id, user_id: owner.userId, title });
    if (error) fail(`owner could not create note ${title}: ${error.message}`);
  }

  const { data: written, error: writeError } = await owner.client
    .from("chat_messages")
    .insert({
      note_id: pageNoteId,
      user_id: owner.userId,
      role: "user",
      content: "what did we decide about pricing?",
      scope: "all_notes",
    })
    .select("id")
    .single();
  if (writeError) fail(`owner could not insert a turn: ${writeError.message}`);
  else chatIds.push(written.id);

  const ownerRead = await owner.client
    .from("chat_messages")
    .select("id, content, user_id")
    .eq("note_id", pageNoteId);
  console.log(
    `  owner     role=${owner.role}  rows=${ownerRead.data?.length ?? 0}  error=${
      ownerRead.error ? JSON.stringify(ownerRead.error.message) : "null"
    }`,
  );
  if (ownerRead.error) fail("owner read errored");
  else if ((ownerRead.data?.length ?? 0) === 0) fail("owner should see rows");

  // ---------------------------------------------------------------- proof 2
  console.log("");
  console.log("--- proof 2: the second user sees NOTHING, and gets no error ---");
  console.log(
    `query: select id, content, user_id from chat_messages where note_id = '${pageNoteId}'`,
  );
  const intruderRead = await intruder.client
    .from("chat_messages")
    .select("id, content, user_id")
    .eq("note_id", pageNoteId);
  console.log(
    `  intruder  role=${intruder.role}  rows=${intruderRead.data?.length ?? 0}  error=${
      intruderRead.error ? JSON.stringify(intruderRead.error.message) : "null"
    }`,
  );
  // An error here is a FAILURE, not a pass. "permission denied" means the
  // grant is missing; a genuine empty result means RLS filtered the rows.
  if (intruderRead.error)
    fail("expected a genuine empty result, not an error — the grant is wrong");
  else if ((intruderRead.data?.length ?? 0) !== 0)
    fail("second user saw another user's chat");

  // ---------------------------------------------------------------- proof 3
  console.log("");
  console.log("--- proof 3: the insert policy refuses a forged user_id ---");
  const forged = await intruder.client.from("chat_messages").insert({
    note_id: pageNoteId,
    user_id: owner.userId,
    role: "user",
    content: "written on someone else's behalf",
    scope: "this_note",
  });
  console.log(
    `  refused=${Boolean(forged.error)}  code=${forged.error?.code ?? null}  error=${JSON.stringify(
      forged.error?.message ?? null,
    )}`,
  );
  if (!forged.error) fail("a user inserted a turn owned by someone else");

  // ---------------------------------------------------------------- proof 4
  console.log("");
  console.log("--- proof 4: with check refuses handing a row away ---");
  const handoff = await owner.client
    .from("chat_messages")
    .update({ user_id: intruder.userId })
    .eq("id", chatIds[0])
    .select("id");
  const handedOver = !handoff.error && (handoff.data?.length ?? 0) > 0;
  console.log(
    `  refused=${!handedOver}  code=${handoff.error?.code ?? null}  error=${JSON.stringify(
      handoff.error?.message ?? null,
    )}`,
  );
  // Either an outright error or zero matched rows is a pass: with check makes
  // the new row fail the policy, so it can never land.
  if (handedOver) fail("a user reassigned their row's user_id");

  // ---------------------------------------------------------------- proof 5
  console.log("");
  console.log("--- proof 5: the citation floor — a cited note is deleted ---");
  const { data: assistant, error: assistantError } = await owner.client
    .from("chat_messages")
    .insert({
      note_id: pageNoteId,
      user_id: owner.userId,
      role: "assistant",
      content: "You agreed to raise it [[cite:c1]].",
      scope: "all_notes",
      metadata: {
        citations: [
          {
            key: "c1",
            chunkId: crypto.randomUUID(),
            noteId: citedNoteId,
            noteTitle: "chat RLS probe - the cited note",
            chunkType: "takeaway",
            tsStart: null,
          },
        ],
      },
    })
    .select("id")
    .single();
  if (assistantError) fail(`could not write the assistant turn: ${assistantError.message}`);
  else chatIds.push(assistant.id);

  const dropped = await owner.client
    .from("notes")
    .delete()
    .eq("id", citedNoteId);
  if (dropped.error) fail(`could not delete the cited note: ${dropped.error.message}`);

  const after = await owner.client
    .from("chat_messages")
    .select("id, content, metadata")
    .eq("id", assistant?.id ?? "");
  const row = after.data?.[0];
  const citations = row?.metadata?.citations ?? [];
  const stillReferencesDeleted = citations.some((c) => c.noteId === citedNoteId);

  console.log(`  message survived the cited note's deletion : ${Boolean(row)}`);
  console.log(`  citation still names the deleted note      : ${stillReferencesDeleted}`);
  console.log(`  prose is intact                            : ${JSON.stringify(row?.content ?? null)}`);

  // The message MUST survive: metadata is opaque jsonb, so nothing cascades.
  // This is the exact state parse-citations.ts must handle — one marker, zero
  // resolvable citations, so the answer renders but must not read as grounded.
  if (!row) fail("the assistant turn was deleted along with the cited note");
  if (!stillReferencesDeleted)
    fail("the dangling citation vanished — the client can no longer detect it");

  const stillResolvable = await owner.client
    .from("notes")
    .select("id")
    .eq("id", citedNoteId);
  console.log(`  the cited note is really gone              : ${(stillResolvable.data?.length ?? 0) === 0}`);
  if ((stillResolvable.data?.length ?? 0) !== 0)
    fail("the cited note was not actually deleted, so the proof is vacuous");
} finally {
  await cleanup();
}

console.log("");
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
