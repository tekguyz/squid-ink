#!/usr/bin/env node
/**
 * Status-sync doc checks for squid-ink.
 *
 * Repo-only. No browser, no dev server, no network. Covers the claims that can
 * be measured mechanically, so they cannot be reasoned past under context
 * pressure. Everything else in the status-sync audit is a judgement call and stays
 * in SKILL.md.
 *
 * Exit 0 = clean, 1 = findings, 2 = could not run (NOT a pass).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFrozenSurfaceCounts } from "./frozen-surface-count.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/** Basenames under node_modules, built lazily and only when something needs
 *  one. CLAUDE.md cites a dependency's own type file by name at a pinned
 *  version; that is a real claim, it just does not live in this tree. */
let DEP_BASENAMES = null;
const dependencyFileExists = (name) => {
  if (DEP_BASENAMES === null) {
    DEP_BASENAMES = new Set();
    const walk = (dir, depth) => {
      if (depth > 5 || !existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full, depth + 1);
        else DEP_BASENAMES.add(entry);
      }
    };
    walk(path.join(ROOT, "node_modules"), 0);
  }
  return DEP_BASENAMES.has(name);
};

function fatal(message) {
  console.error(`CANNOT RUN — ${message}`);
  process.exit(2);
}

for (const required of ["CLAUDE.md", "package.json", "app/globals.css"]) {
  if (!has(required)) fatal(`${required} is missing`);
}

const claude = read("CLAUDE.md");
const pkg = JSON.parse(read("package.json"));

/** CLAUDE.md was split on 2026-09-09: five feature sections moved to
 *  `.claude/rules/*.md` with `paths:` frontmatter so they load only when Claude
 *  touches a matching file. The prose moved; the claims in it did not stop being
 *  claims. Checks 2 and 3 scan the rules alongside CLAUDE.md so the split cost
 *  no coverage. Check 1 deliberately does NOT — the pinned-version table has one
 *  home, and a second table anywhere would be the drift it exists to catch. */
const RULES_DIR = ".claude/rules";
const ruleFiles = has(RULES_DIR)
  ? readdirSync(path.join(ROOT, RULES_DIR)).filter((f) => f.endsWith(".md")).sort()
  : [];
const governing = [claude, ...ruleFiles.map((f) => read(`${RULES_DIR}/${f}`))].join("\n");
const governingLabel = ruleFiles.length
  ? `CLAUDE.md + ${ruleFiles.length} rule file(s)`
  : "CLAUDE.md";

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

/* 2 — every `npm run <script>` the rules name actually exists -------------- */
{
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const named = new Set([...governing.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]));
  for (const script of named) {
    if (!scripts.has(script)) findings.push(`${governingLabel} names \`npm run ${script}\`, which is not in package.json scripts`);
  }
  notes.push(`npm scripts: ${named.size} referenced in ${governingLabel}, all resolve`);
}

/* 3 — every repo path the rules name in backticks exists ------------------- */
{
  const paths = new Set(
    [...governing.matchAll(/`([a-zA-Z0-9_./[\]-]+\.(?:tsx?|css|mjs|json|md))`/g)].map((m) => m[1]),
  );
  // CLAUDE.md names some files by basename alone (`diarization-policy.ts`,
  // `verify-rls.mjs`). Those are real files, just not at the repo root, so a
  // bare name is resolved by basename anywhere in the tree rather than being
  // reported missing. A name carrying a slash is still an exact path claim.
  // Two shapes of name are true claims about a file that is correctly absent
  // from the tree, and reporting them is noise rather than drift:
  //
  //  - a dependency's own file (`genai.d.ts`), read at a pinned version. The
  //    BASENAMES walk skips node_modules deliberately, so resolve these there.
  //  - a file the prose names as DELETED. "the deleted `persona-presets.ts`"
  //    is a claim that it is gone; demanding it exist inverts the sentence.
  const deletedNames = new Set(
    [...governing.matchAll(/deleted `([a-zA-Z0-9_./-]+)`/g)].map((m) => m[1]),
  );
  let checked = 0;
  for (const p of paths) {
    if (p.startsWith(".") && !p.startsWith("./")) continue; // dotfiles like .gitignore
    if (deletedNames.has(p)) continue;
    checked++;
    const found = p.includes("/") ? has(p) : basenameExists(p) || dependencyFileExists(p);
    if (!found) findings.push(`${governingLabel} names \`${p}\`, which does not exist`);
  }
  notes.push(`paths: ${checked} named in ${governingLabel}, all exist`);
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
    // "RESOLVED 2026-09-05 — framed controls sat at ~1.4:1 against the sheet".
    // --control-edge was invented after the design lock to clear WCAG 1.4.11's
    // 3:1, so no design file can contain it. Both values were chosen by
    // measuring against every sheet a control sits on: 3.34:1 light worst case
    // (rail/pane), 3.44:1 dark worst case (raised).
    ["oklch(0.585 0.016 70)", "--control-edge light, computed for 3:1, post-lock"],
    ["oklch(0.550 0.014 78)", "--control-edge dark, computed for 3:1, post-lock"],
  ]);

  // The second acceptance path: a token annotated in app/globals.css as
  //
  //   /* DERIVED: 6.08:1 against --tag-1-fill, WCAG 1.4.3 */
  //   --tag-1: oklch(0.42 0.12 142);
  //
  // A value derived by flipping lightness is measured, not drawn, so it is
  // held to its measurement instead of a drawing. The annotation is NOT
  // trusted: the ratio is recomputed from both oklch() values (the counterpart
  // resolved in the same selector block), and must match the stated ratio to
  // 0.01 AND clear the criterion's bar. Anything malformed fails and names the
  // token. Proven 2026-09-13 to reproduce all ten recorded tag ratios exactly.
  const CRITERIA = new Map([["1.4.3", 4.5], ["1.4.11", 3]]);
  const ANNOTATION = /^\/\*\s*DERIVED:\s*([0-9]+(?:\.[0-9]+)?):1 against (--[a-z0-9-]+), WCAG ([0-9.]+)\s*\*\/$/;
  const DECL = /^(--[a-z0-9-]+):\s*([^;]+);/;
  const OKLCH_PARTS = /^oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\)$/;

  // OKLab → linear sRGB (Ottosson), clamped to gamut, → WCAG relative luminance.
  const luminance = (value) => {
    const m = value.match(OKLCH_PARTS);
    if (!m) return null;
    const [L, C, H] = m.slice(1).map(Number);
    const a = C * Math.cos((H * Math.PI) / 180);
    const b = C * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
    const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
    const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };

  const cssLines = read("app/globals.css").split("\n").map((l) => l.trim());
  const blocks = [new Map()];
  const stack = [0];
  const declBlock = [];
  for (let i = 0; i < cssLines.length; i++) {
    const line = cssLines[i];
    const decl = line.match(DECL);
    if (decl) {
      blocks[stack.at(-1)].set(decl[1], decl[2].trim());
      declBlock[i] = stack.at(-1);
    }
    for (const ch of line.replace(/\/\*.*?\*\//g, "")) {
      if (ch === "{") {
        blocks.push(new Map());
        stack.push(blocks.length - 1);
      } else if (ch === "}" && stack.length > 1) stack.pop();
    }
  }

  const annotated = new Set();
  let derivedChecked = 0;
  for (let i = 0; i < cssLines.length; i++) {
    if (!cssLines[i].includes("DERIVED:")) continue;
    const next = cssLines.slice(i + 1).findIndex((l) => l !== "");
    const j = next === -1 ? -1 : i + 1 + next;
    const decl = j === -1 ? null : cssLines[j].match(DECL);
    if (!decl) {
      findings.push(`app/globals.css:${i + 1} has a DERIVED annotation with no token declared directly below it`);
      continue;
    }
    const [, token, value] = decl;
    annotated.add(value.trim());
    const where = `app/globals.css:${j + 1} ${token}`;
    const m = cssLines[i].match(ANNOTATION);
    if (!m) {
      findings.push(`${where} is annotated DERIVED but the annotation does not parse — expected "/* DERIVED: <ratio>:1 against --<token>, WCAG <1.4.3|1.4.11> */"`);
      continue;
    }
    const [, statedText, against, criterion] = m;
    const stated = Number(statedText);
    const bar = CRITERIA.get(criterion);
    if (bar === undefined) {
      findings.push(`${where} names WCAG ${criterion}; only 1.4.3 (4.5:1) and 1.4.11 (3:1) are recognised`);
      continue;
    }
    if (stated < bar) {
      findings.push(`${where} records ${stated}:1, below WCAG ${criterion}'s ${bar}:1 — the derivation does not clear its own bar`);
      continue;
    }
    const other = blocks[declBlock[j]].get(against);
    const [la, lb] = [luminance(value.trim()), other === undefined ? null : luminance(other)];
    if (la === null || lb === null) {
      findings.push(`${where}: cannot recompute against ${against} — both must be plain oklch(L C H) in the same selector block`);
      continue;
    }
    const actual = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    if (Math.abs(actual - stated) > 0.01) {
      findings.push(`${where} records ${stated}:1 against ${against}; recomputed it is ${actual.toFixed(2)}:1`);
      continue;
    }
    if (actual < bar) {
      findings.push(`${where} recomputes to ${actual.toFixed(2)}:1, below WCAG ${criterion}'s ${bar}:1`);
      continue;
    }
    derivedChecked++;
  }

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
      // Annotated: already passed or already reported above, by token name.
      if (annotated.has(value)) continue;
      if (DERIVED.has(value)) {
        if (!gaps.includes(value)) {
          findings.push(`app/globals.css uses ${value} (${DERIVED.get(value)}), which no design file contains and docs/KNOWN_GAPS.md no longer records`);
        }
        continue;
      }
      findings.push(`app/globals.css uses ${value}, which appears in neither design file — a token was hand-edited away from the locked design`);
    }
    notes.push(`tokens: ${shipped.size} colours in globals.css, ${derivedChecked} DERIVED annotation(s) recomputed and clear, ${DERIVED.size} documented as derived, rest traceable to a design file`);
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

/* 6 — no template app name in shipped code --------------------------------- */
// Narrowed 2026-09-14. This banned "Squid Ink" too while the name was
// unconfirmed; CLAUDE.md § Naming locked it on 2026-09-07, and the check went
// on flagging it for a week (first caught on the onboarding screen). What stays
// banned is "Crispy Bacon", the design template's placeholder name — App
// Surfaces 05 still draws it, which is exactly how it would get copied in.
{
  const BANNED = /crispy.?bacon/i;
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
      findings.push(`${file.replace(/\\/g, "/")} contains "Crispy Bacon" — the design template's placeholder name; the app is Squid Ink (CLAUDE.md § Naming)`);
    }
  }
  notes.push(`app name: ${sources.length} source files scanned, no template placeholder name`);
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

  // The secret key bypasses RLS, so where it may be read is a policy, and the
  // policy lives in CLAUDE.md > Supabase > Keys. The allowlist is PARSED from
  // that section, not kept by hand. Until 2026-09-15 it was a second list
  // here: it named six files while CLAUDE.md named ten, and the check still
  // printed "the 6 files CLAUDE.md allows" and passed.
  //
  // Two paragraphs carry the list. The one about "shipped application code"
  // names the shipped file by path. The "local-only" one names scripts by
  // bare basename, up to "None ships." — the correction note after that
  // sentence names a DELETED script, which must not be allowed back in.
  const ALLOWED_SECRET_FILES = new Set();
  {
    // core.autocrlf is true on these machines; normalise before matching lines.
    const keys = claude.replace(/\r\n/g, "\n").match(/^### Keys\n([\s\S]*?)(?=^#{1,3} )/m)?.[1] ?? "";
    const paragraphs = keys.split(/\n\s*\n/);
    const shipped = paragraphs.find((p) => /shipped application code/.test(p)) ?? "";
    const local = (paragraphs.find((p) => /local-only/.test(p)) ?? "").split("None ships.")[0];
    for (const [, name] of shipped.matchAll(/`([\w./-]+\/[\w.-]+\.(?:tsx?|mjs|js))`/g)) {
      ALLOWED_SECRET_FILES.add(name);
    }
    const scripts = [...local.matchAll(/`([\w.-]+\.(?:mjs|js))`/g)].map((m) => `scripts/${m[1]}`);
    for (const s of scripts) ALLOWED_SECRET_FILES.add(s);

    if (ALLOWED_SECRET_FILES.size === 0) {
      findings.push("CLAUDE.md > Supabase > Keys names no file that may read the secret key — the allowlist could not be parsed");
    }
    // The prose states its own count ("Nine local-only"). A count that
    // disagrees with the names beside it is the drift this section has had
    // three times.
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    const stated = local.match(/\*\*(\w+) local-only\*\*/i)?.[1]?.toLowerCase();
    const statedN = stated === undefined ? -1 : WORDS.indexOf(stated);
    if (stated !== undefined && statedN !== scripts.length) {
      findings.push(`CLAUDE.md > Supabase > Keys says "${stated} local-only" scripts but names ${scripts.length}`);
    }
    for (const f of ALLOWED_SECRET_FILES) {
      if (!has(f)) findings.push(`CLAUDE.md > Supabase > Keys allows ${f} to read the secret key, but no such file exists`);
    }
  }
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
    //
    // Line comments are stripped for the same reason, and AFTER strings so a
    // "https:" prefix inside a string is never mistaken for a comment. This
    // file moved from .claude/skills/handoff/ to scripts/ on 2026-09-08, which
    // put it inside its own scan for the first time - and the comments above
    // name the variable, so it reported itself as the breach. A name in a
    // COMMENT is not a name READ, exactly as a name QUOTED is not.
    const scannable = src
      .replace(/'[^'\n]*'|"[^"\n]*"/g, '""')
      .replace(/\/\/[^\n]*/g, "");

    // `\benv\.` matches both forms a read takes here: `process.env.X` in app
    // code, and `env.X` in every script under scripts/, which reads the key
    // from a parsed .env.local. Until 2026-09-15 only the first was matched,
    // so a new script reading the key was never flagged.
    for (const m of scannable.matchAll(/\benv\.([A-Z0-9_]+)/g)) {
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

/* 13 — no file under .claude/ carries a frozen surface count ------------- */
{
  // How many App Surfaces are built lives on the docs/ROADMAP.md status line
  // and nowhere else. Skills copied it three times (handoff 2026-09-09,
  // doc-audit 2026-09-12) and each copy decayed on its own, so a built surface
  // was reported as scope creep. Harness worktrees are skipped: each is a full
  // copy of another branch, not this tree's files.
  const DIR = ".claude";
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(ROOT, rel))) {
      const child = `${rel}/${entry}`;
      if (child === ".claude/worktrees") continue;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else if (/\.(md|sh|json)$/.test(entry)) files.push(child);
    }
  };
  if (has(DIR)) walk(DIR);
  for (const rel of files) {
    for (const hit of findFrozenSurfaceCounts(read(rel))) {
      findings.push(`${rel}:${hit.line} says "${hit.phrase}"; the built-surface count lives only on the docs/ROADMAP.md status line — point at it instead`);
    }
  }
  notes.push(`frozen surface counts: ${files.length} file(s) under .claude/, none restates the count`);
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
