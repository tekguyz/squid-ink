import { beforeEach, describe, expect, it, vi } from "vitest";

/** DEMO-STANDARD.md rule 9, issue #19: the landing page is indexed, and no
 *  page rendered for a session is. */
const deps = vi.hoisted(() => ({ user: null as { id: string; is_anonymous?: boolean } | null }));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => deps.user }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font" });
  return { Bitter: font, Archivo: font, IBM_Plex_Mono: font };
});
vi.mock("@/components/recorder/signed-in-dock", () => ({ SignedInDock: () => null }));
vi.mock("@/components/demo/demo-banner", () => ({ DemoBanner: () => null }));
vi.mock("@/components/theme-boot", () => ({ ThemeBoot: () => null }));

const { generateMetadata } = await import("../layout");

beforeEach(() => {
  deps.user = null;
});

describe("root layout metadata", () => {
  it("leaves the landing page indexable when there is no session", async () => {
    expect((await generateMetadata()).robots).toBeUndefined();
  });

  it("marks a demo visitor's pages noindex", async () => {
    deps.user = { id: "visitor-1", is_anonymous: true };
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });

  it("marks a real account's pages noindex too", async () => {
    deps.user = { id: "owner" };
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });
});
