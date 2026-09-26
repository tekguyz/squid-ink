/**
 * Reads the HOSTED auth email templates back through the Supabase management
 * API and diffs them against the repo copies: the `[auth.email.template.*]`
 * subjects in supabase/config.toml and the HTML files under
 * supabase/templates/. docs/DEPLOYMENT.md § Auth email.
 *
 *   node scripts/verify-email-templates.mjs
 *
 * Needs SUPABASE_ACCESS_TOKEN (a personal access token; this repo sets it in
 * the gitignored .claude/settings.local.json) and NEXT_PUBLIC_SUPABASE_URL
 * from .env.local, for the project ref. Read-only: it never writes the hosted
 * config, and it does not read the secret key.
 *
 * Exit 0: they match. 1: they differ. 2: could not run — NOT a pass.
 */
import { readFileSync } from "node:fs";
import { findTemplateDrift, readRepoTemplates } from "./email-template-drift.mjs";

function fail(message) {
  console.error(`verify-email-templates: ${message}`);
  process.exit(2);
}

function projectRef() {
  let env = "";
  try {
    env = readFileSync(".env.local", "utf8");
  } catch {
    // Fall through to process.env.
  }
  const url =
    env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) fail("no NEXT_PUBLIC_SUPABASE_URL in .env.local or the environment");
  return ref;
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) fail("SUPABASE_ACCESS_TOKEN is not set (see .claude/settings.local.json)");

// content_path in config.toml is relative to the repo root, where this runs.
const repo = readRepoTemplates(readFileSync("supabase/config.toml", "utf8"), (path) =>
  readFileSync(path, "utf8"),
);
if (repo.length === 0) fail("no [auth.email.template.*] section in supabase/config.toml");

const ref = projectRef();
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
// process.exitCode, not process.exit(): exiting right after a fetch trips a
// libuv assertion on Windows (UV_HANDLE_CLOSING) and turns every result into 127.
if (!res.ok) {
  console.error(`verify-email-templates: management API answered ${res.status} for project ${ref}`);
  process.exitCode = 2;
} else {
  const drift = findTemplateDrift(await res.json(), repo);
  if (drift.length === 0) {
    console.log(`ok: ${repo.map((t) => t.name).join(", ")} match hosted (subject and body)`);
  } else {
    for (const d of drift) {
      console.log(`DRIFT ${d.name} ${d.field} (${d.key})`);
      if (d.field === "subject") {
        console.log(`  hosted: ${JSON.stringify(d.hosted)}`);
        console.log(`  repo:   ${JSON.stringify(d.repo)}`);
      } else {
        const h = d.hosted?.replace(/\r\n/g, "\n").split("\n");
        const r = d.repo?.replace(/\r\n/g, "\n").split("\n");
        const at = h && r ? h.findIndex((line, i) => line !== r[i]) : -1;
        const line = at === -1 ? (h && r ? h.length : 0) : at;
        console.log(`  first difference at line ${line + 1}`);
        console.log(`  hosted: ${h === undefined ? "missing" : JSON.stringify(h[line] ?? "(end)")}`);
        console.log(`  repo:   ${r === undefined ? "missing" : JSON.stringify(r[line] ?? "(end)")}`);
      }
    }
    console.log("Paste the repo copy into the dashboard, or bring the repo copy up to the hosted one.");
    process.exitCode = 1;
  }
}
