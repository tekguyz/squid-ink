/**
 * Prints a one-time sign-in URL for the RLS fixture owner.
 *
 * Login is magic-link only (signInWithOtp), and docs/KNOWN_GAPS.md records that
 * emailed links are spent by a GET before a human clicks them. generateLink
 * mints the token without sending mail, so a browser can be signed in for a
 * local verification pass without changing a line of application code.
 *
 * Local verification only. Never wire this into the app.
 * Run with: node scripts/print-signin-link.mjs [http://localhost:3000]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const origin = process.argv[2] ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: env.RLS_TEST_OWNER_EMAIL,
});
if (error) throw error;

console.log(`user id : ${data.user.id}`);
console.log(
  `sign in : ${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2F`,
);
