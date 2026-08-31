// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/** `/api/cron` is exempt from the session middleware (see session.ts) because a
 *  cron invocation carries no cookies and Vercel does not follow the redirect
 *  it would otherwise get. That exemption is a PREFIX, so every future route
 *  under app/api/cron/ is unauthenticated by default.
 *
 *  This test is what stops that being a trap: a new cron route that forgets its
 *  own bearer check is a publicly callable endpoint, and on this project those
 *  endpoints spend money. */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const CRON_DIR = path.join(ROOT, "app", "api", "cron");

function cronRouteFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts" || entry === "route.tsx") found.push(full);
    }
  };
  walk(CRON_DIR);
  return found;
}

describe("every route under app/api/cron", () => {
  it("has at least one route to check", () => {
    expect(cronRouteFiles().length).toBeGreaterThan(0);
  });

  it("gates itself on CRON_SECRET", () => {
    const ungated = cronRouteFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      return !source.includes("CRON_SECRET");
    });

    expect(ungated.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("refuses the request before doing any work", () => {
    // The gate must be the first thing each exported handler does. A check
    // placed after the Supabase client is built, or after the Gemini client is
    // constructed, has already spent something on an anonymous caller.
    const late = cronRouteFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      const handler = source.indexOf("export async function GET");
      if (handler === -1) return false;

      const body = source.slice(handler);
      const gate = body.indexOf("isAuthorized");
      const work = body.indexOf("createClient(");

      if (gate === -1) return true;
      return work !== -1 && work < gate;
    });

    expect(late.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
