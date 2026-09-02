#!/usr/bin/env node
/**
 * Handoff doc checks for squid-ink.
 *
 * Repo-only. No browser, no dev server, no network. Covers the claims that can
 * be measured mechanically, so they cannot be reasoned past under context
 * pressure. Everything else in the handoff audit is a judgement call and stays
 * in SKILL.md.
 *
 * Exit 0 = clean, 1 = findings, 2 = could not run (NOT a pass).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const findings = [];
const notes = [];

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => existsSync(path.join(ROOT, rel));

/** Every source basename in the tree, built once. CLAUDE.md refers to plenty of
 *  files by name alone; a bare name is a real claim about a file existing, just
 *  not a claim about where it sits. */
const BASENAMES = (() => {
  const seen = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else seen.add(entry);
    }
  };
  walk(ROOT);
  return seen;
})();
const basenameExists = (name) => BASENAMES.has(name);

function fatal(message) {
  console.error(`CANNOT RUN — ${message}`);
  process.exit(2);
}

for (const required of ["CLAUDE.md", "package.json", "app/globals.css"]) {
  if (!has(required)) fatal(`${required} is missing`);
}

const claude = read("CLAUDE.md");
const pkg = JSON.parse(read("package.json"));

/* 1 — the pinned-version table in CLAUDE.md against package.json ----------- */
{
  const declared = new Map();
  for (const [name, version] of Object.entries({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  })) {
    declared.set(name, version);
    if (/^[\^~>=<]/.test(version)) {
      findings.push(`package.json: "${name}": "${version}" is a range, not an exact pin`);
    }
  }

  // Table rows look like: | next | 16.3.3 |
  const stated = new Map();
  for (const line of claude.split("\n")) {
    const m = line.match(/^\|\s*([@a-z0-9/.-]+)\s*\|\s*([0-9][0-9a-z.\-+]*)\s*\|/i);
    if (m && declared.has(m[1])) stated.set(m[1], m[2]);
  }

  if (stated.size === 0) {
    findings.push("CLAUDE.md: no pinned-version table row matched a package.json dependency — the table was renamed or removed, so this check is watching nothing");
  } else {
    for (const [name, version] of stated) {
      if (declared.get(name) !== version) {
        findings.push(`CLAUDE.md states ${name} ${version}; package.json has ${declared.get(name)}`);
      }
    }
    for (const name of declared.keys()) {
      if (!stated.has(name)) {
        findings.push(`package.json depends on ${name} but CLAUDE.md's version table does not list it`);
      }
    }
    notes.push(`version table: ${stated.size} packages cross-checked`);
  }
}

/* 2 — every `npm run <script>` CLAUDE.md names actually exists ------------- */
{
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const named = new Set([...claude.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]));
  for (const script of named) {
    if (!scripts.has(script)) findings.push(`CLAUDE.md names \`npm run ${script}\`, which is not in package.json scripts`);
  }
  notes.push(`npm scripts: ${named.size} referenced, all resolve`);
}

/* 3 — every repo path CLAUDE.md names in backticks exists ------------------ */
{
  const paths = new Set(
    [...claude.matchAll(/`([a-zA-Z0-9_./[\]-]+\.(?:tsx?|css|mjs|json|md))`/g)].map((m) => m[1]),
  );
  // CLAUDE.md names some files by basename alone (`diarization-policy.ts`,
  // `verify-rls.mjs`). Those are real files, just not at the repo root, so a
  // bare name is resolved by basename anywhere in the tree rather than being
  // reported missing. A name carrying a slash is still an exact path claim.
  let checked = 0;
  for (const p of paths) {
    if (p.startsWith(".") && !p.startsWith("./")) continue; // dotfiles like .gitignore
    checked++;
    const found = p.includes("/") ? has(p) : basenameExists(p);
    if (!found) findings.push(`CLAUDE.md names \`${p}\`, which does not exist`);
  }
  notes.push(`paths: ${checked} named in CLAUDE.md, all exist`);
}

/* 4 — every colour in globals.css traces to a design file ----------------- */
{
  // Both design files are sources now. Note Detail is the only built screen,
  // but the recorder HUD implements App Surfaces 02b and lifts its values from
  // there, so checking Note Detail alone reports every HUD token as drift.
  const designFiles = [
    "design-reference/Note Detail.dc.html",
    "design-reference/App Surfaces.dc.html",
  ];

  // Values that are deliberately in NO design file, each with the reason and
  // the docs/KNOWN_GAPS.md section that records it. Adding a line here is a
  // decision, not a silencing: an undocumented derived value is still drift.
  const DERIVED = new Map([
    // "`--live` light-theme value is derived, not from the design" — 02b is
    // dark-only, so the light red follows the accent pattern instead.
    ["oklch(0.520 0.170 25)", "--live light, derived from 02b's dark 0.66"],
  ]);

  const missing = designFiles.filter((f) => !has(f));
  if (missing.length) {
    findings.push(`${missing.join(", ")} missing — token provenance cannot be verified`);
  } else {
    const OKLCH = /oklch\([0-9.]+ [0-9.]+ [0-9.]+\)/g;
    const designValues = new Set(designFiles.flatMap((f) => read(f).match(OKLCH) ?? []));
    const shipped = new Set(read("app/globals.css").match(OKLCH) ?? []);

    const gaps = has("docs/KNOWN_GAPS.md") ? read("docs/KNOWN_GAPS.md") : "";
    for (const value of shipped) {
      if (designValues.has(value)) continue;
      if (DERIVED.has(value)) {
        if (!gaps.includes(value)) {
          findings.push(`app/globals.css uses ${value} (${DERIVED.get(value)}), which no design file contains and docs/KNOWN_GAPS.md no longer records`);
        }
        continue;
      }
      findings.push(`app/globals.css uses ${value}, which appears in neither design file — a token was hand-edited away from the locked design`);
    }
    notes.push(`tokens: ${shipped.size} colours in globals.css, ${DERIVED.size} documented as derived, rest traceable to a design file`);
  }
}

/* 5 — the eight locked accent values, verbatim ----------------------------- */
{
  const LOCKED = [
    "oklch(0.452 0.148 146)", "oklch(0.402 0.138 146)",
    "oklch(0.905 0.064 142)", "oklch(0.978 0.024 140)",
    "oklch(0.82 0.15 140)", "oklch(0.86 0.15 142)",
    "oklch(0.30 0.06 140)", "oklch(0.18 0.05 140)",
  ];
  const css = read("app/globals.css");
  for (const value of LOCKED) {
    if (!css.includes(value)) findings.push(`locked accent ${value} is no longer in app/globals.css`);
  }
  notes.push(`locked accents: ${LOCKED.length}/8 present`);
}

/* 6 — no app name in shipped code ----------------------------------------- */
{
  const BANNED = /squid.?ink|crispy.?bacon/i;
  const sources = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry)) sources.push(path.relative(ROOT, full));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(path.join(ROOT, dir));

  for (const file of sources) {
    if (BANNED.test(read(file))) {
      findings.push(`${file.replace(/\\/g, "/")} contains an app-name string — the public name is unconfirmed and must not be hardcoded`);
    }
  }
  notes.push(`app name: ${sources.length} source files scanned, none names the app`);
}

/* 7 — exactly the three locked typefaces ----------------------------------- */
{
  const layout = "app/layout.tsx";
  if (!has(layout)) {
    findings.push(`${layout} is missing — typeface lock cannot be verified`);
  } else {
    const src = read(layout);
    const imported = [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)]
      .flatMap((m) => m[1].split(",").map((s) => s.trim()))
      .filter(Boolean)
      .sort();
    const EXPECTED = ["Archivo", "Bitter", "IBM_Plex_Mono"];
    if (imported.join(",") !== EXPECTED.join(",")) {
      findings.push(`${layout} loads [${imported.join(", ")}]; the locked set is [${EXPECTED.join(", ")}]`);
    }
    notes.push(`typefaces: ${imported.join(", ")}`);
  }
}

/* 8 — Supabase key hygiene ------------------------------------------------ */
{
  const SECRET_HINT = /(SECRET|SERVICE_ROLE)/;
  const sources = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs|js)$/.test(entry)) sources.push(path.relative(ROOT, full));
    }
  };
  for (const dir of ["app", "components", "lib", "scripts"]) walk(path.join(ROOT, dir));

  // AMENDED 2026-08-31. The secret key bypasses RLS, so where it may be read
  // is a policy, and the policy changed: the cron route has no user session
  // and therefore no RLS identity, so it must read it from the Vercel
  // environment. Six local-only scripts read it from .env.local; none ships.
  // Keep this list identical to CLAUDE.md > Supabase > Keys.
  const ALLOWED_SECRET_FILES = new Set([
    "app/api/cron/transcribe/route.ts",
    "scripts/verify-rls.mjs",
    "scripts/verify-storage-rls.mjs",
    "scripts/verify-recorder-upload.mjs",
    "scripts/verify-persona-provisioning.mjs",
    "scripts/verify-transcription-pipeline.mjs",
    "scripts/print-signin-link.mjs",
  ]);
  // Tests for an allowed file exercise the same variable and are allowed too.
  const isAllowedSecretFile = (rel) =>
    ALLOWED_SECRET_FILES.has(rel) ||
    [...ALLOWED_SECRET_FILES].some((f) =>
      rel.startsWith(f.replace(/\/[^/]+$/, "/__tests__/")),
    );
  // Confinement is about the Supabase secret specifically. CRON_SECRET is a
  // shared bearer token, not an RLS bypass — the NEXT_PUBLIC_ check above
  // still covers it, which is the way it could actually leak.
  const SUPABASE_SECRET = /^SUPABASE_(SECRET|SERVICE_ROLE)/;
  let scanned = 0;
  for (const file of sources) {
    scanned++;
    const src = read(file);
    const rel = file.split(path.sep).join("/");

    for (const m of src.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      if (SECRET_HINT.test(m[0])) {
        findings.push(`${rel} reads ${m[0]} — a NEXT_PUBLIC_ prefix ships the value to the browser, and this one names a secret`);
      }
    }
    // Quoted strings are stripped before this scan, the same way the RLS check
    // strips comments and for the same reason: a name QUOTED is not a name
    // READ. The two guards that enforce this very rule —
    // project-conventions.test.ts and actions.test.ts — both carry
    // "process.env.SUPABASE_SECRET_KEY" as a search string, and matching them
    // reported the enforcement as the breach.
    //
    // Single- and double-quoted only. Template literals are left intact
    // because `${process.env.SUPABASE_SECRET_KEY}` IS a read.
    const scannable = src.replace(/'[^'\n]*'|"[^"\n]*"/g, '""');

    for (const m of scannable.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (SUPABASE_SECRET.test(m[1]) && !isAllowedSecretFile(rel)) {
        findings.push(
          `${rel} reads ${m[1]}; the Supabase secret key is confined to the ` +
            `${ALLOWED_SECRET_FILES.size} files named in CLAUDE.md > Supabase > Keys`,
        );
      }
    }
    // A literal key pasted into source rather than read from the environment.
    if (/\bsb_secret_[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/.test(src)) {
      findings.push(`${rel} contains a literal Supabase key — keys are read from the environment, never committed`);
    }
  }

  // .env* must stay ignored, with the example file the only exception.
  if (has(".gitignore")) {
    const ignore = read(".gitignore");
    if (!/^\.env\*?/m.test(ignore)) {
      findings.push(".gitignore does not ignore .env* — the secret key can be committed");
    }
  }
  notes.push(
    `supabase keys: ${scanned} files scanned, secret confined to the ` +
      `${ALLOWED_SECRET_FILES.size} files CLAUDE.md allows`,
  );
}

/* 9 — four per-operation RLS policies per table, wrapped auth.uid() ------- */
{
  const dir = path.join(ROOT, "supabase/schemas");
  if (!existsSync(dir)) {
    notes.push("supabase schemas: none present, RLS shape not checked");
  } else {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    if (files.length === 0) findings.push("supabase/schemas holds no .sql file, but CLAUDE.md calls it the source of truth");
    for (const file of files) {
      const rel = `supabase/schemas/${file}`;
      // Strip `--` comments first: the schema files explain these very rules in
      // prose, and a rule quoted in a comment is not a policy.
      const sql = read(rel)
        .toLowerCase()
        .split("\n")
        .map((line) => line.split("--")[0])
        .join(" ")
        .replace(/\s+/g, " ");

      // A file that creates neither a table nor a policy is not an RLS file.
      // persona_provisioning.sql is a security definer function plus its
      // trigger; holding it to the four-policy rule reports the absence of a
      // table as drift.
      const declaresTable = /create table/.test(sql);
      const declaresPolicy = /create policy/.test(sql);
      if (!declaresTable && !declaresPolicy) {
        notes.push(`${rel}: no table and no policy, RLS shape not applicable`);
        continue;
      }

      if (/for all\b/.test(sql)) {
        findings.push(`${rel} has a blanket \`for all\` policy; the rule is four per-operation policies`);
      }
      // Four operations for a table this file owns. Policies on a table it does
      // not own are a different case: storage_audio.sql deliberately ships no
      // DELETE policy, because note deletion is not a decided feature and a
      // policy with no consumer is a hole. The next clause catches one being
      // added back without that decision being re-made.
      const requiredOps = declaresTable
        ? ["select", "insert", "update", "delete"]
        : ["select", "insert", "update"];
      for (const op of requiredOps) {
        if (!sql.includes(`for ${op} to authenticated`)) {
          findings.push(`${rel} has no \`for ${op} to authenticated\` policy`);
        }
      }
      if (!declaresTable && sql.includes("for delete to authenticated")) {
        findings.push(`${rel} adds a DELETE policy on a table it does not own; that omission was deliberate, so decide it again before allowing it`);
      }
      const updateBlock = sql.split("create policy").find((b) => b.includes("for update")) ?? "";
      if (updateBlock && !updateBlock.includes("with check")) {
        findings.push(`${rel} UPDATE policy has no \`with check\`; a user could reassign user_id`);
      }
      const uidTotal = (sql.match(/auth\.uid\(\)/g) ?? []).length;
      const uidWrapped = (sql.match(/\( *select auth\.uid\(\)/g) ?? []).length;
      if (uidTotal !== uidWrapped) {
        findings.push(`${rel} uses ${uidTotal - uidWrapped} bare \`auth.uid()\`; each must be wrapped as \`(select auth.uid())\` or it re-evaluates per row`);
      }
      // Only a file that owns its table can revoke on it. storage.objects is
      // owned by supabase_storage_admin, and a revoke from postgres there is a
      // documented no-op.
      if (declaresTable && !/revoke\s+all/.test(sql)) {
        findings.push(`${rel} does not \`revoke all\` before granting; project defaults hand anon and authenticated TRUNCATE`);
      }
    }
    notes.push(`RLS: ${files.length} schema file(s), four per-operation policies each`);
  }
}

/* 10 — the Project-attached doc set is all present ------------------------ */
{
  // The planning Project attaches these four as standing knowledge and
  // DEPLOYMENT.md on demand. DECISIONS.md and ROADMAP.md moved into the tree
  // on 2026-08-31; before that no check here could read them, which is how a
  // decision and its contradiction lived in two files for a day.
  const ATTACHED = [
    "CLAUDE.md",
    "docs/KNOWN_GAPS.md",
    "docs/DECISIONS.md",
    "docs/ROADMAP.md",
    "docs/DEPLOYMENT.md",
  ];
  for (const doc of ATTACHED) {
    if (!has(doc)) findings.push(`${doc} is missing — the planning Project attaches it`);
  }
  notes.push(`planning docs: ${ATTACHED.length}/${ATTACHED.length} present`);
}

/* 11 — no doc claims, in the present tense, that a doc that exists does not - */
{
  // The exact drift the 2026-08-31 move created: four passages in KNOWN_GAPS
  // still said DECISIONS.md and ROADMAP.md were "not on disk here" and could
  // not be verified. History written in the past tense is legitimate and must
  // not trip this, so a past-tense marker on the line exempts it.
  const ABSENCE = /(not on disk|not in the repo|not in this repo|not files in this repo|cannot be verified by|`find` cannot see|absent from this tree)/i;
  const PAST = /\b(was|were|until|before|predat|superseded|at the time|no longer|used to|had been|that day)\b/i;
  const NAMES = /(DECISIONS\.md|ROADMAP\.md|DEPLOYMENT\.md|KNOWN_GAPS\.md)/;
  const DOCS = ["CLAUDE.md", "docs/KNOWN_GAPS.md", "docs/DECISIONS.md", "docs/ROADMAP.md", "docs/DEPLOYMENT.md"];
  let scanned = 0;
  for (const doc of DOCS) {
    if (!has(doc)) continue;
    const lines = read(doc).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!ABSENCE.test(line)) continue;
      // The filename often sits on the previous or next line in wrapped prose.
      const window = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
      if (!NAMES.test(window)) continue;
      const named = window.match(NAMES)[1];
      const onDisk = has(`docs/${named}`) || has(named);
      if (onDisk && !PAST.test(window)) {
        findings.push(`${doc}:${i + 1} says ${named} is absent, in the present tense; it is in the tree`);
      }
      scanned++;
    }
  }
  notes.push(`provenance: ${scanned} absence claim(s) examined, none contradicts the tree`);
}

/* 12 — DEPLOYMENT.md's numbers against the code they describe -------------- */
{
  // DEPLOYMENT.md is the only record that this repo is deployed at all, and
  // its three figures are the ones sized to the Vercel Hobby ceiling. A number
  // raised in code and not here reads as a plan change that never happened.
  if (has("docs/DEPLOYMENT.md")) {
    const dep = read("docs/DEPLOYMENT.md");
    const pairs = [
      {
        label: "cron schedule",
        docRe: /`(\d[^`]*\*[^`]*)`/,
        docValue: (dep.match(/schedules `\/api\/cron\/transcribe` at `([^`]+)`/) ?? [])[1],
        srcFile: "vercel.json",
        srcValue: () => (JSON.parse(read("vercel.json")).crons ?? [])[0]?.schedule,
      },
      {
        label: "maxDuration",
        docValue: (dep.match(/maxDuration = (\d+)/) ?? [])[1],
        srcFile: "app/api/cron/transcribe/route.ts",
        srcValue: () => (read("app/api/cron/transcribe/route.ts").match(/maxDuration\s*=\s*(\d+)/) ?? [])[1],
      },
      {
        label: "MAX_TRANSCRIPTIONS_PER_RUN",
        docValue: (dep.match(/MAX_TRANSCRIPTIONS_PER_RUN = (\d+)/) ?? [])[1],
        srcFile: "lib/transcription/sweep.ts",
        srcValue: () => (read("lib/transcription/sweep.ts").match(/MAX_TRANSCRIPTIONS_PER_RUN\s*=\s*(\d+)/) ?? [])[1],
      },
    ];
    let compared = 0;
    for (const pair of pairs) {
      if (pair.docValue === undefined) {
        findings.push(`docs/DEPLOYMENT.md no longer states the ${pair.label}; check 12 cannot compare it`);
        continue;
      }
      if (!has(pair.srcFile)) {
        findings.push(`${pair.srcFile} is missing; docs/DEPLOYMENT.md documents its ${pair.label}`);
        continue;
      }
      const actual = pair.srcValue();
      compared++;
      if (String(actual) !== String(pair.docValue)) {
        findings.push(
          `${pair.label}: docs/DEPLOYMENT.md says ${pair.docValue}, ${pair.srcFile} says ${actual}`,
        );
      }
    }
    notes.push(`deployment numbers: ${compared} figure(s) match the code`);
  }
}

/* ------------------------------------------------------------------------- */
if (findings.length === 0) {
  for (const note of notes) console.log(`ok   ${note}`);
  console.log("\nAll doc checks clean.");
  process.exit(0);
}

for (const finding of findings) console.log(`DRIFT  ${finding}`);
console.log(`\n${findings.length} finding(s).`);
process.exit(1);
