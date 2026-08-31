/**
 * Proves owner-only RLS on the audio-recordings Storage bucket with two real
 * auth users.
 *
 * Same proof path as scripts/verify-rls.mjs: both users sign in for real, the
 * returned JWT is attached to a PUBLISHABLE-key client, and every token's role
 * claim is checked to read "authenticated" before any result is trusted. The
 * secret key is used only to create the fixtures and to clean up afterwards --
 * never to produce a result the proof depends on.
 *
 * Ownership here is the object PATH: {user_id}/{file}. A denial therefore has
 * to be told apart from a plain miss, because Storage answers an RLS-filtered
 * download with "Object not found" -- the same words it uses for an object
 * that was never written. Every cross-tenant read below runs against an object
 * the admin client has just confirmed exists, and is paired with a list() so
 * the admin-visible count can be compared against the caller's.
 *
 * NOT COVERED HERE: the app's own cookie plumbing through proxy.ts into a
 * server component. That is verified separately in the browser. Neither path
 * substitutes for the other.
 *
 * Not part of `npm test` -- it needs network access and the secret key.
 * Run with: node scripts/verify-storage-rls.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const PROBE = "verify-storage-rls.bin";
const FIRST = "first write";
const SECOND = "second write, same path";

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

/** Read the role claim without verifying -- we only need to prove we are NOT
 *  running as service_role. Storage does the real verification. */
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

/** Sign in for real, then hand the returned token to a publishable-key
 *  client. Storage validates it and picks the role from the token. */
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
      `refusing to trust a result from role "${role}" -- the proof requires ` +
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

const body = (text) => new Blob([text], { type: "application/octet-stream" });

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

await ensureUser(admin, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
await ensureUser(admin, env.RLS_TEST_INTRUDER_EMAIL, env.RLS_TEST_INTRUDER_PASSWORD);

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

const ownerPath = `${owner.userId}/${PROBE}`;
const intruderPath = `${intruder.userId}/${PROBE}`;
const anonPath = `${owner.userId}/anon-probe.bin`;

console.log("proof path : A - real password-grant JWT via Authorization header");
console.log("             (NOT session cookies through the proxy - see path B)");
console.log(`bucket     : ${BUCKET}`);
console.log(`owner      : ${owner.email}  ${owner.userId}  role=${owner.role}`);
console.log(`second user: ${intruder.email}  ${intruder.userId}  role=${intruder.role}`);
console.log(`paths      : ${ownerPath}`);
console.log(`             ${intruderPath}`);
console.log("");

try {
  // --- The bucket is private -------------------------------------------
  console.log("--- bucket is private ---");
  const { data: buckets } = await admin.storage.listBuckets();
  const found = buckets?.find((b) => b.id === BUCKET);
  check("bucket exists", Boolean(found), `id=${found?.id ?? "none"}`);
  check("bucket is private", found?.public === false, `public=${found?.public}`);
  console.log("");

  // --- Owner: insert, read, overwrite ----------------------------------
  console.log("--- owner writes and reads their own path ---");

  const ins = await owner.client.storage.from(BUCKET).upload(ownerPath, body(FIRST));
  check("INSERT at own path", !ins.error, `error=${JSON.stringify(ins.error?.message ?? null)}`);

  const readBack = await owner.client.storage.from(BUCKET).download(ownerPath);
  const readText = readBack.data ? await readBack.data.text() : null;
  check(
    "SELECT reads it back",
    readText === FIRST,
    `got=${JSON.stringify(readText)} error=${JSON.stringify(readBack.error?.message ?? null)}`,
  );

  // upsert replaces the object in place. This is the step that fails
  // silently when only INSERT is granted -- it is the whole reason the
  // UPDATE policy exists.
  const upd = await owner.client.storage
    .from(BUCKET)
    .upload(ownerPath, body(SECOND), { upsert: true });
  check(
    "UPDATE overwrites same path",
    !upd.error,
    `error=${JSON.stringify(upd.error?.message ?? null)}`,
  );

  // Confirm the overwrite through the DATABASE ROW, not through download().
  // Storage serves object reads via a caching CDN, so a download() issued
  // immediately after an upsert can hand back the pre-overwrite body -- it
  // did exactly that while this script was being written. list() reads
  // storage.objects itself, and reading it as the OWNER means the select
  // policy has to admit the updated row for this to return anything at all.
  //
  // Two things are asserted: still ONE object (replaced in place, not a
  // second row alongside the first), and its recorded size is SECOND's, not
  // FIRST's. The two strings are deliberately different lengths.
  const ownerList = await owner.client.storage.from(BUCKET).list(owner.userId);
  const probeRow = ownerList.data?.find((o) => o.name === PROBE);
  check(
    "still exactly one object at that prefix",
    (ownerList.data?.length ?? 0) === 1,
    `rows=${ownerList.data?.length ?? 0} error=${JSON.stringify(ownerList.error?.message ?? null)}`,
  );
  check(
    "overwrite actually took (row size is the second body)",
    probeRow?.metadata?.size === SECOND.length,
    `size=${probeRow?.metadata?.size} expected=${SECOND.length} (first body was ${FIRST.length})`,
  );

  // And the bytes really are on disk, read with the admin client so no
  // policy is in the way of this particular assertion.
  const adminRead = await admin.storage.from(BUCKET).download(ownerPath);
  const adminText = adminRead.data ? await adminRead.data.text() : null;
  check("overwritten bytes are the second body", adminText === SECOND, `got=${JSON.stringify(adminText)}`);
  console.log("");

  // The second user writes their own object, so the cross-tenant reads
  // below are denials of something that exists rather than misses.
  const seed = await intruder.client.storage.from(BUCKET).upload(intruderPath, body(FIRST));
  check(
    "second user can write their OWN path",
    !seed.error,
    `error=${JSON.stringify(seed.error?.message ?? null)}`,
  );
  console.log("");

  // --- Cross-tenant, both directions -----------------------------------
  for (const [label, actor, foreignPath] of [
    ["owner -> second user's path", owner, intruderPath],
    ["second user -> owner's path", intruder, ownerPath],
  ]) {
    console.log(`--- ${label} ---`);
    const foreignPrefix = foreignPath.split("/")[0];

    const write = await actor.client.storage.from(BUCKET).upload(foreignPath, body("intrusion"));
    check(
      "INSERT refused",
      Boolean(write.error),
      `error=${JSON.stringify(write.error?.message ?? null)}`,
    );

    const over = await actor.client.storage
      .from(BUCKET)
      .upload(foreignPath, body("intrusion"), { upsert: true });
    check(
      "UPDATE refused",
      Boolean(over.error),
      `error=${JSON.stringify(over.error?.message ?? null)}`,
    );

    const read = await actor.client.storage.from(BUCKET).download(foreignPath);
    check(
      "SELECT refused",
      Boolean(read.error) || read.data === null,
      `error=${JSON.stringify(read.error?.message ?? null)}`,
    );

    // A download error on its own could be a plain miss. list() separates
    // the two: the admin sees the object, the caller must see nothing.
    const adminList = await admin.storage.from(BUCKET).list(foreignPrefix);
    const actorList = await actor.client.storage.from(BUCKET).list(foreignPrefix);
    check(
      "the object really is there (admin sees it)",
      (adminList.data?.length ?? 0) === 1,
      `admin rows=${adminList.data?.length ?? 0}`,
    );
    check(
      "LIST returns empty, not permission-denied",
      !actorList.error && (actorList.data?.length ?? 0) === 0,
      `rows=${actorList.data?.length ?? 0} error=${JSON.stringify(actorList.error?.message ?? null)}`,
    );

    // The refused overwrite above must not have changed the object either --
    // an error alongside a mutated body would be a false pass. Compared by
    // recorded size from the row already fetched, not by downloading: a
    // download here would be CDN-cached and could report either body
    // regardless of what is actually stored.
    const expectedBody = foreignPath === ownerPath ? SECOND : FIRST;
    check(
      "the object's contents are untouched",
      adminList.data?.[0]?.metadata?.size === expectedBody.length,
      `size=${adminList.data?.[0]?.metadata?.size} expected=${expectedBody.length} ("intrusion" would be ${"intrusion".length})`,
    );
    console.log("");
  }

  // --- anon has nothing ------------------------------------------------
  console.log("--- anon (publishable key, no session) ---");
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonRead = await anon.storage.from(BUCKET).download(ownerPath);
  check(
    "anon SELECT refused",
    Boolean(anonRead.error),
    `error=${JSON.stringify(anonRead.error?.message ?? null)}`,
  );

  const anonWrite = await anon.storage.from(BUCKET).upload(anonPath, body("anon"));
  check(
    "anon INSERT refused",
    Boolean(anonWrite.error),
    `error=${JSON.stringify(anonWrite.error?.message ?? null)}`,
  );

  const anonList = await anon.storage.from(BUCKET).list(owner.userId);
  check(
    "anon LIST sees nothing",
    (anonList.data?.length ?? 0) === 0,
    `rows=${anonList.data?.length ?? 0} error=${JSON.stringify(anonList.error?.message ?? null)}`,
  );
  console.log("");
} finally {
  // Cleanup runs pass or fail. No DELETE policy exists by design, so no
  // authenticated user can remove an object -- removal is the admin
  // client's job. That is the policy working, not a shortcut around it.
  console.log("--- cleanup ---");
  const { data: removed, error: removeError } = await admin.storage
    .from(BUCKET)
    .remove([ownerPath, intruderPath, anonPath]);
  console.log(
    `  removed ${removed?.length ?? 0} object(s)  error=${JSON.stringify(removeError?.message ?? null)}`,
  );

  let leftovers = 0;
  for (const prefix of [owner.userId, intruder.userId]) {
    const { data } = await admin.storage.from(BUCKET).list(prefix);
    leftovers += data?.length ?? 0;
  }
  check("bucket has no leftover probe objects", leftovers === 0, `leftovers=${leftovers}`);
  console.log("");
}

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
