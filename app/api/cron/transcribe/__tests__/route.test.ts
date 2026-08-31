// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.CRON_SECRET = "the-real-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/cron/transcribe/route");
  return GET(new Request("https://example.test/api/cron/transcribe", { headers }));
}

describe("GET /api/cron/transcribe — the CRON_SECRET gate", () => {
  it("rejects a request with no Authorization header", async () => {
    expect((await get()).status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("rejects the right secret without the Bearer prefix", async () => {
    // Vercel always sends "Bearer <value>". Accepting the bare value would
    // widen the gate for no reason.
    expect((await get({ authorization: "the-real-secret" })).status).toBe(401);
  });

  it("refuses every request when CRON_SECRET is unset, rather than opening up", async () => {
    delete process.env.CRON_SECRET;
    expect((await get({ authorization: "Bearer anything" })).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it("never constructs a Gemini client for an unauthorized request", async () => {
    // The whole point of the gate: an unauthenticated caller must not be able
    // to spend the API key.
    const genai = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: genai }));

    await get({ authorization: "Bearer wrong" });

    expect(genai).not.toHaveBeenCalled();
  });
});
