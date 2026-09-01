import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
/** `app` joined the list on 2026-08-31, when the transcription cron route put
 *  substantial logic there for the first time. Until then everything in `app/`
 *  was a thin page or layout and the guard never reached it — which meant the
 *  400-line ceiling and the colour-literal rule silently did not apply to the
 *  largest new file in the repo. */
const SCANNED = ["app", "components", "lib"];

/** Every source file we ship, excluding the tests that police them. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) found.push(path.relative(ROOT, full));
    }
  };
  for (const dir of SCANNED) walk(path.join(ROOT, dir));
  return found;
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

  it("contains no inline colour literals — every colour is a token", () => {
    const offenders = sourceFiles().filter((f) =>
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

  it("keeps every file under the 400-line hard ceiling", () => {
    const offenders = sourceFiles()
      .map((f) => [f, read(f).split("\n").length] as const)
      .filter(([, lines]) => lines > 400);
    expect(offenders).toEqual([]);
  });
});
