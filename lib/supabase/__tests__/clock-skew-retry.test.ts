import { describe, expect, it, vi } from "vitest";
import { withClockSkewRetry } from "@/lib/supabase/clock-skew-retry";

const skew = () =>
  new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
const ok = () => new Response("[]", { status: 200 });

function harness(responses: (() => Response)[]) {
  const calls: unknown[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(input);
    return (responses.shift() ?? ok)();
  }) as unknown as typeof fetch;
  const waits: number[] = [];
  const wrapped = withClockSkewRetry(fetchImpl, async (ms) => void waits.push(ms));
  return { wrapped, calls, waits };
}

describe("withClockSkewRetry", () => {
  it("retries PGRST303 and returns the retry's answer — the 2026-09-14 production crash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wrapped, calls, waits } = harness([skew, ok]);
    const res = await wrapped("https://x.supabase.co/rest/v1/notes", { method: "GET" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([750]);
    warn.mockRestore();
  });

  it("gives up after three waits and hands back the refusal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wrapped, calls, waits } = harness([skew, skew, skew, skew, skew]);
    const res = await wrapped("https://x.supabase.co/rest/v1/notes");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([750, 1500, 3000]);
    warn.mockRestore();
  });

  it("never retries any other 401 — an expired or forged token must fail at once", async () => {
    const { wrapped, calls } = harness([
      () => new Response(JSON.stringify({ code: "PGRST301", message: "JWT expired" }), { status: 401 }),
    ]);
    expect((await wrapped("https://x.supabase.co/rest/v1/notes")).status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("leaves a success untouched, body still readable", async () => {
    const { wrapped, calls } = harness([ok]);
    const res = await wrapped("https://x.supabase.co/rest/v1/notes");
    expect(await res.text()).toBe("[]");
    expect(calls).toHaveLength(1);
  });
});
