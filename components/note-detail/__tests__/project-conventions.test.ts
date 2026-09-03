import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** Directories that hold no source of ours: build output, dependencies, the
 *  tests that police the source, and every tool's dot-folder. Everything else
 *  under ROOT is walked, so a source folder added tomorrow is covered the day
 *  it appears. An allowlist of directory names is always one new folder
 *  behind — which is how `app/` went unscanned until 2026-08-31. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  "__tests__",
  ".next",
  "out",
  "build",
  "coverage",
]);

const isSkippedDir = (entry: string) =>
  SKIPPED_DIRS.has(entry) || entry.startsWith(".");

/** Config, test and type-declaration scaffolding — named by convention rather
 *  than by location, for the same reason the directories are. */
const isNonSource = (entry: string) =>
  /\.(config|setup|test|spec)\.[cm]?[jt]sx?$/.test(entry) ||
  /\.d\.ts$/.test(entry);

function walk(match: (entry: string) => boolean): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!isSkippedDir(entry)) visit(full);
      } else if (!isNonSource(entry) && match(entry)) {
        found.push(path.relative(ROOT, full));
      }
    }
  };
  visit(ROOT);
  return found.sort();
}

/** Every TypeScript file we ship, excluding the tests that police them. */
function sourceFiles(): string[] {
  return walk((entry) => /\.tsx?$/.test(entry));
}

/** What the colour rule covers: shipped TypeScript plus every stylesheet.
 *  `app/globals.css` is the one file allowed to name a colour, and it is
 *  excluded by FILENAME, not by path — a second `globals.css` grown somewhere
 *  else is exactly the file this rule must still catch. */
const COLOUR_SOURCE_OF_TRUTH = "globals.css";

function colourScannedFiles(): string[] {
  return [...sourceFiles(), ...walk((entry) => /\.css$/.test(entry))].filter(
    (f) => path.basename(f) !== COLOUR_SOURCE_OF_TRUTH,
  );
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("project conventions", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it("actually reaches the files added on 2026-09-01", () => {
    // "The guard covers it" is otherwise an assertion about a walk nobody
    // watched. These two are the manual-transcription trigger's new
    // components; if the walk ever stops reaching them, this fails rather
    // than the colour rule silently going quiet.
    const scanned = sourceFiles();
    for (const file of [
      path.join("components", "note-detail", "transcribe-button.tsx"),
      path.join("components", "dashboard", "status-pill.tsx"),
      path.join("lib", "transcription", "transcribe-note.ts"),
      path.join("lib", "transcription", "supabase-ports.ts"),
      path.join("lib", "notes", "transcription-status.ts"),
    ]) {
      expect(scanned).toContain(file);
    }
  });

  it("scans the whole tree, not a list of directories", () => {
    // Evidence the exclusions did not quietly eat a real source folder, and
    // that files outside app/, components/ and lib/ are reached at all.
    const scanned = sourceFiles();
    for (const file of [
      path.join("app", "api", "cron", "transcribe", "route.ts"),
      path.join("components", "note-detail", "transcribe-button.tsx"),
      path.join("lib", "transcription", "transcribe-note.ts"),
      "proxy.ts",
    ]) {
      expect(scanned).toContain(file);
    }
    // Stylesheets are in the colour scan; the one exempt file is not.
    expect(colourScannedFiles()).not.toContain(path.join("app", "globals.css"));
  });

  it("contains no inline colour literals — every colour is a token", () => {
    const offenders = colourScannedFiles().filter((f) =>
      /oklch\(|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("reads SUPABASE_SECRET_KEY from exactly one shipped file", () => {
    // The key bypasses RLS. The cron route needs it because a cron invocation
    // carries no session and therefore no RLS identity; nothing else does. The
    // manual Transcribe action added on 2026-09-01 runs as the signed-in user,
    // and this guard is what keeps it that way.
    const readers = sourceFiles().filter((f) =>
      read(f).includes("process.env.SUPABASE_SECRET_KEY"),
    );
    expect(readers).toEqual([
      path.join("app", "api", "cron", "transcribe", "route.ts"),
    ]);
  });

  it("reads VOYAGE_API_KEY from exactly the two shipped triggers", () => {
    // Server-only, exactly like the Gemini key. The embedding pipeline has two
    // entry points and no third: the deferred half of the Transcribe action,
    // and the cron route's third phase. If a client component ever reaches a
    // module that reads this, the key ships to the browser — this is the guard
    // that stops that, and lib/rag/* deliberately reads no env var at all.
    const readers = sourceFiles().filter((f) =>
      read(f).includes("process.env.VOYAGE_API_KEY"),
    );
    expect(readers.sort()).toEqual([
      path.join("app", "api", "cron", "transcribe", "route.ts"),
      path.join("app", "notes", "actions", "transcription.ts"),
    ]);
  });

  it("keeps VOYAGE_API_KEY out of every client component's import graph", () => {
    // A blunt but decisive check: no file that declares "use client" may
    // mention the key, and no file under lib/rag/ may read process.env at all,
    // so a client component cannot reach it transitively through lib/rag.
    const clientFiles = sourceFiles().filter((f) =>
      /^\s*["']use client["']/m.test(read(f)),
    );
    expect(clientFiles.filter((f) => read(f).includes("VOYAGE_API_KEY"))).toEqual(
      [],
    );

    const ragFiles = sourceFiles().filter((f) =>
      f.startsWith(path.join("lib", "rag")),
    );
    expect(ragFiles.length).toBeGreaterThan(0);
    expect(ragFiles.filter((f) => read(f).includes("process.env"))).toEqual([]);
  });

  it("keeps every file under the 400-line hard ceiling", () => {
    const offenders = sourceFiles()
      .map((f) => [f, read(f).split("\n").length] as const)
      .filter(([, lines]) => lines > 400);
    expect(offenders).toEqual([]);
  });
});
