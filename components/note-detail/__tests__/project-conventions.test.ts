import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCANNED = ["components", "lib"];

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

  it("contains no inline colour literals — every colour is a token", () => {
    const offenders = sourceFiles().filter((f) =>
      /oklch\(|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every file under the 400-line hard ceiling", () => {
    const offenders = sourceFiles()
      .map((f) => [f, read(f).split("\n").length] as const)
      .filter(([, lines]) => lines > 400);
    expect(offenders).toEqual([]);
  });
});
