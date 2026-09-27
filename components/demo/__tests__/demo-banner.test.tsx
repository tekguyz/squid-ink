import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ user: null as { id: string; is_anonymous?: boolean } | null }));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/app/notes/actions/demo", () => ({ leaveDemo: vi.fn() }));

const { DemoBanner } = await import("../demo-banner");

async function renderBanner() {
  const element = await DemoBanner();
  return render(<>{element}</>);
}

beforeEach(() => {
  state.user = null;
});

/** Issue #19: the banner a demo visitor sees on every page. */
describe("DemoBanner", () => {
  it("tells a visitor this is the demo, who built it, and both ways out", async () => {
    state.user = { id: "visitor-1", is_anonymous: true };
    await renderBanner();

    const banner = screen.getByRole("complementary", { name: "Demo" });
    expect(banner).toHaveTextContent(/sample notes/i);
    expect(banner).toHaveTextContent(/built by TEKGUYZ/i);
    expect(screen.getByRole("link", { name: /case study/i })).toHaveAttribute(
      "href",
      "https://tekguyz.com/work/ai-meeting-notes",
    );
    // A form, so it posts; never a link to /login.
    const leave = screen.getByRole("button", { name: "Leave demo" });
    expect(leave.closest("form")).not.toBeNull();
    expect(banner).toHaveAttribute("data-demo-banner");
  });

  it("renders nothing for a real account", async () => {
    state.user = { id: "owner", is_anonymous: false };
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no session", async () => {
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
});
