import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** "/" decides by session (issue #60). With no user it is the landing page and
 *  reads nothing else: there is no RLS identity, so a dashboard query would
 *  return nothing or fail. With a user it is the Dashboard, as before. */
const deps = vi.hoisted(() => ({
  user: null as { id: string } | null,
  feed: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => deps.user }));
vi.mock("@/lib/notes/get-dashboard-feed", () => ({ getDashboardFeed: deps.feed }));
// The Dashboard's children are someone else's tests; here they only have to
// say which screen rendered.
vi.mock("@/components/dashboard/identity-rail", () => ({ IdentityRail: () => <nav>rail</nav> }));
vi.mock("@/components/dashboard/dashboard-header", () => ({
  DashboardHeader: () => <h1>All notes</h1>,
}));
vi.mock("@/components/dashboard/note-feed", () => ({ NoteFeed: () => null }));

import Root, { generateMetadata } from "../page";

const searchParams = Promise.resolve({});

beforeEach(() => {
  deps.user = null;
  deps.feed.mockReset();
  deps.feed.mockResolvedValue({
    email: "a@b.test",
    tagChips: [],
    activeTag: null,
    shownNotes: 0,
    hasOlder: false,
    totalNotes: 0,
    groups: [],
  });
});

describe("the root page", () => {
  it("shows the landing page with no session, and never asks for the feed", async () => {
    render(await Root({ searchParams }));

    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("All notes");
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
    expect(deps.feed).not.toHaveBeenCalled();
  });

  it("shows the Dashboard to a signed-in user", async () => {
    deps.user = { id: "u1" };
    render(await Root({ searchParams }));

    expect(screen.getByRole("heading", { name: "All notes" })).toBeInTheDocument();
    expect(deps.feed).toHaveBeenCalledOnce();
  });

  it("titles each screen for who is looking", async () => {
    expect((await generateMetadata()).title).toMatch(/Squid Ink/);
    deps.user = { id: "u1" };
    expect((await generateMetadata()).title).toBe("All notes");
  });
});
