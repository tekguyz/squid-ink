// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The server client signs in; the admin client creates or repairs the
 *  account. Both are mocked: this file proves the route's decisions, and
 *  scripts/verify-rls.mjs is where the real auth server is exercised. */
const signIn = vi.fn();
const createServerClient = vi.fn(async () => ({
  auth: { signInWithPassword: signIn },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createServerClient }));

const createUser = vi.fn();
const listUsers = vi.fn();
const updateUserById = vi.fn();
const createAdminClient = vi.fn(() => ({
  auth: { admin: { createUser, listUsers, updateUserById } },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: createAdminClient }));

let envFile: string;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("DEV_LOGIN_PASSWORD", "the-dev-password");
  // The route writes <cwd>/.env.local. Point cwd at a scratch folder so a
  // test never touches the real one.
  const dir = mkdtempSync(path.join(tmpdir(), "dev-login-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  envFile = path.join(dir, ".env.local");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function get(query = "") {
  const { GET } = await import("@/app/api/dev-login/route");
  return GET(new Request(`http://localhost:3123/api/dev-login${query}`));
}

describe("GET /api/dev-login — development only", () => {
  it.each(["production", "test", ""])("answers 404 when NODE_ENV is %j", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    const res = await get();

    expect(res.status).toBe(404);
    // Refused before any work: no client built, nothing signed in.
    expect(createServerClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/dev-login — signing in", () => {
  it("signs in the dev account and redirects to / on the request's own origin", async () => {
    signIn.mockResolvedValue({ error: null });
    const res = await get();

    expect(signIn).toHaveBeenCalledWith({
      email: "dev@squid-ink.test",
      password: "the-dev-password",
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3123/");
    // A working account never touches the secret key.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("follows a same-origin ?next=", async () => {
    signIn.mockResolvedValue({ error: null });
    const res = await get("?next=/personas");

    expect(res.headers.get("location")).toBe("http://localhost:3123/personas");
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example/"])(
    "refuses an off-origin ?next=%s and lands on /",
    async (next) => {
      signIn.mockResolvedValue({ error: null });
      const res = await get(`?next=${encodeURIComponent(next)}`);

      expect(res.headers.get("location")).toBe("http://localhost:3123/");
    },
  );

  it("creates a missing account, onboarded and confirmed, then signs in", async () => {
    signIn
      .mockResolvedValueOnce({ error: { message: "Invalid login credentials" } })
      .mockResolvedValueOnce({ error: null });
    createUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    const res = await get();

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "dev@squid-ink.test",
        password: "the-dev-password",
        email_confirm: true,
        user_metadata: { onboarded_at: expect.any(String) },
      }),
    );
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(307);
  });

  it("resets the password of an existing account whose password drifted", async () => {
    signIn
      .mockResolvedValueOnce({ error: { message: "Invalid login credentials" } })
      .mockResolvedValueOnce({ error: null });
    createUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: "email_exists",
        message: "A user with this email address has already been registered",
      },
    });
    listUsers.mockResolvedValue({
      data: { users: [{ id: "other", email: "x@y.test" }, { id: "u1", email: "dev@squid-ink.test" }] },
      error: null,
    });
    updateUserById.mockResolvedValue({ error: null });

    const res = await get();

    expect(updateUserById).toHaveBeenCalledWith("u1", { password: "the-dev-password" });
    expect(res.status).toBe(307);
  });

  it("answers 500 with the reason when sign-in still fails", async () => {
    signIn.mockResolvedValue({ error: { message: "Auth is down" } });
    createUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Auth is down");
  });
});

describe("GET /api/dev-login — the password", () => {
  it("generates DEV_LOGIN_PASSWORD into .env.local when it is missing", async () => {
    vi.stubEnv("DEV_LOGIN_PASSWORD", "");
    writeFileSync(envFile, "OTHER=1");
    signIn.mockResolvedValue({ error: null });

    await get();

    const written = readFileSync(envFile, "utf8");
    const match = written.match(/^DEV_LOGIN_PASSWORD=(\S+)$/m);
    expect(written.startsWith("OTHER=1\n")).toBe(true);
    expect(match?.[1]?.length).toBeGreaterThanOrEqual(32);
    // The hosted password policy: one of each class, or createUser refuses.
    for (const kind of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]) {
      expect(match?.[1]).toMatch(kind);
    }
    expect(signIn).toHaveBeenCalledWith(
      expect.objectContaining({ password: match?.[1] }),
    );
  });

  it("leaves .env.local alone when the password is already set", async () => {
    writeFileSync(envFile, "OTHER=1\n");
    signIn.mockResolvedValue({ error: null });

    await get();

    expect(readFileSync(envFile, "utf8")).toBe("OTHER=1\n");
  });
});
