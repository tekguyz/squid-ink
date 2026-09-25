import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { ONBOARDED_AT_KEY } from "@/lib/onboarding/onboarding-state";

/** DEV ONLY. Signs in the dev account on the server and drops the session
 *  cookie, so a local browser — or an agent driving the browser pane, which may
 *  not type a password — reaches the signed-in app from one link.
 *
 *  A REAL sign-in, not an auth bypass: the session is an ordinary
 *  `authenticated` JWT, so RLS applies exactly as it does to any user. A bypass
 *  would let broken RLS pass unnoticed.
 *
 *  SECRET KEY. The second shipped reader, after the cron route (CLAUDE.md >
 *  Supabase > Keys). It is read only when sign-in fails, to create the account
 *  or reset its password, so the route survives a delete-account test. The
 *  NODE_ENV check comes first, so outside development nothing is read at all.
 *
 *  `?next=/path` lands there instead of `/`, same origin only.
 *  Model: tekguyz-crm/src/app/api/dev-login/route.ts. */
const DEV_LOGIN_EMAIL = "dev@squid-ink.test";

export async function GET(request: Request) {
  // Allowlist, not a `!== "production"` denylist: on a build whose NODE_ENV is
  // unset or unexpected, this route does not exist.
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  const password = devLoginPassword();
  const supabase = await createClient();
  const credentials = { email: DEV_LOGIN_EMAIL, password };

  let failure = (await supabase.auth.signInWithPassword(credentials)).error?.message;
  if (failure) {
    failure =
      (await ensureAccount(password)) ??
      (await supabase.auth.signInWithPassword(credentials)).error?.message;
  }
  if (failure) {
    return new NextResponse(`dev-login failed for ${DEV_LOGIN_EMAIL}: ${failure}`, {
      status: 500,
    });
  }

  // Back to the origin the request came in on, never a fixed one: preview
  // servers take any free port, and the cookie is host-scoped, not port-scoped.
  const url = new URL(request.url);
  // safeNext refuses `//host` and `/\host`; the origin check is a second
  // layer, so any path the URL parser reads as foreign still lands on `/`.
  const target = new URL(safeNext(url.searchParams.get("next")), url.origin);
  return NextResponse.redirect(target.origin === url.origin ? target : new URL("/", url.origin));
}

/** DEV_LOGIN_PASSWORD from .env.local. When it is missing, a random one is
 *  appended there and used, so a fresh clone needs no setup. */
function devLoginPassword(): string {
  const existing = process.env.DEV_LOGIN_PASSWORD;
  if (existing) return existing;

  // The hosted project demands a lower, an upper, a digit and a symbol, and
  // base64url alone does not always carry all four. Measured 2026-09-25.
  const generated = `${randomBytes(24).toString("base64url")}-Aa1`;
  const envFile = path.join(process.cwd(), ".env.local");
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(envFile, `${separator}DEV_LOGIN_PASSWORD=${generated}\n`);
  process.env.DEV_LOGIN_PASSWORD = generated;
  return generated;
}

/** Create the dev account, or reset its password if it exists with another.
 *  Created confirmed and onboarded, so `/` opens instead of the welcome flow.
 *  Returns an error message, or null when the account is ready. */
async function ensureAccount(password: string): Promise<string | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const created = await admin.auth.admin.createUser({
    email: DEV_LOGIN_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { [ONBOARDED_AT_KEY]: new Date().toISOString() },
  });
  if (!created.error) return null;
  if (created.error.code !== "email_exists") return created.error.message;

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) return listed.error.message;
  const user = listed.data.users.find((u) => u.email === DEV_LOGIN_EMAIL);
  if (!user) return `${DEV_LOGIN_EMAIL} reported as existing but not listed`;

  const updated = await admin.auth.admin.updateUserById(user.id, { password });
  return updated.error?.message ?? null;
}
