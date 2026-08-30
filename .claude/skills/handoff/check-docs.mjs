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
  let checked = 0;
  for (const p of paths) {
    if (p.startsWith(".") && !p.startsWith("./")) continue; // dotfiles like .gitignore
    checked++;
    if (!has(p)) findings.push(`CLAUDE.md names \`${p}\`, which does not exist`);
  }
  notes.push(`paths: ${checked} named in CLAUDE.md, all exist`);
}

/* 4 — every colour in globals.css traces to the design file ---------------- */
{
  const designFile = "design-reference/Note Detail.dc.html";
  if (!has(designFile)) {
    findings.push(`${designFile} is missing — token provenance cannot be verified`);
  } else {
    const design = read(designFile);
    const OKLCH = /oklch\([0-9.]+ [0-9.]+ [0-9.]+\)/g;
    const designValues = new Set(design.match(OKLCH) ?? []);
    const shipped = new Set(read("app/globals.css").match(OKLCH) ?? []);

    for (const value of shipped) {
      if (!designValues.has(value)) {
        findings.push(`app/globals.css uses ${value}, which appears nowhere in ${designFile} — a token was hand-edited away from the locked design`);
      }
    }
    notes.push(`tokens: ${shipped.size} colours in globals.css, all traceable to the design file`);
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

  const ALLOWED_SECRET_FILE = "scripts/verify-rls.mjs";
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
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (SECRET_HINT.test(m[1]) && rel !== ALLOWED_SECRET_FILE) {
        findings.push(`${rel} reads ${m[1]}; the secret key belongs only in ${ALLOWED_SECRET_FILE}`);
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
  notes.push(`supabase keys: ${scanned} files scanned, secret confined to ${ALLOWED_SECRET_FILE}`);
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

      if (/for all\b/.test(sql)) {
        findings.push(`${rel} has a blanket \`for all\` policy; the rule is four per-operation policies`);
      }
      for (const op of ["select", "insert", "update", "delete"]) {
        if (!sql.includes(`for ${op} to authenticated`)) {
          findings.push(`${rel} has no \`for ${op} to authenticated\` policy`);
        }
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
      if (!/revoke\s+all/.test(sql)) {
        findings.push(`${rel} does not \`revoke all\` before granting; project defaults hand anon and authenticated TRUNCATE`);
      }
    }
    notes.push(`RLS: ${files.length} schema file(s), four per-operation policies each`);
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
