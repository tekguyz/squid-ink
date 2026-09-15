import { describe, expect, it } from "vitest";
import {
  SESSION_ONLY_COOKIE,
  isSessionOnly,
  withPersistence,
} from "@/lib/auth/session-persistence";

const LIBRARY_DEFAULT = { path: "/", sameSite: "lax" as const, httpOnly: false, maxAge: 34560000 };

describe("withPersistence — Keep me signed in", () => {
  it("leaves a persistent session's 400-day lifetime alone", () => {
    expect(withPersistence(LIBRARY_DEFAULT, false)).toEqual(LIBRARY_DEFAULT);
  });

  it("strips maxAge and expires for a session-only login, keeping every other option", () => {
    const out = withPersistence({ ...LIBRARY_DEFAULT, expires: new Date(0) }, true);
    expect(out).toEqual({ path: "/", sameSite: "lax", httpOnly: false });
  });

  it("never strips maxAge 0 — that is a DELETE, and stripping it would outlive a sign-out", () => {
    const deletion = { ...LIBRARY_DEFAULT, maxAge: 0 };
    expect(withPersistence(deletion, true)).toEqual(deletion);
  });
});

describe("isSessionOnly", () => {
  it("is true only for the marker set to 1", () => {
    expect(isSessionOnly((n) => (n === SESSION_ONLY_COOKIE ? "1" : undefined))).toBe(true);
    expect(isSessionOnly(() => undefined)).toBe(false);
    expect(isSessionOnly(() => "0")).toBe(false);
  });
});
