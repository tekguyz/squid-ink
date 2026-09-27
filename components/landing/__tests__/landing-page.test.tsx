import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LandingPage } from "../landing-page";

// The Server Action is a server module; the page test only needs its shape.
vi.mock("@/app/notes/actions/demo", () => ({ enterDemo: async () => null }));

/** What a stranger with no session gets at "/" (issue #60): what the product
 *  is, a way to sign in, and honesty about what it does not offer. */
describe("LandingPage", () => {
  it("names the product and says there is no bot in the call", () => {
    render(<LandingPage />);

    expect(screen.getAllByText(/Squid Ink/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/no bot/i);
  });

  it("links to sign-in, and to nowhere that would create an account", () => {
    render(<LandingPage />);

    for (const link of screen.getAllByRole("link", { name: "Sign in" })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(screen.queryByRole("link", { name: /sign up|create account|get started/i })).toBeNull();
    expect(document.body).toHaveTextContent(/invitation/i);
  });

  it("offers the demo as a button in a form, never a link (#19)", () => {
    render(<LandingPage />);

    // A link is a GET, and a GET is followed by previews and crawlers. Only a
    // press may create a demo visitor: docs/adr/0001.
    const button = screen.getByRole("button", { name: "Try the demo" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).not.toBeNull();
    expect(screen.queryByRole("link", { name: /demo/i })).toBeNull();
  });

  it("names TEKGUYZ and links to tekguyz.com", () => {
    render(<LandingPage />);

    expect(document.body).toHaveTextContent(/built by TEKGUYZ/);
    for (const link of screen.getAllByRole("link", { name: /tekguyz/i })) {
      expect(link).toHaveAttribute("href", "https://tekguyz.com");
    }
  });

  it("links each citation chip to the transcript line it cites", () => {
    render(<LandingPage />);

    const chips = screen.getAllByRole("link", { name: /^Jump to transcript at/ });
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const id = chip.getAttribute("href")!.slice(1);
      const line = document.getElementById(id);
      expect(line).not.toBeNull();
      expect(within(line!).getByText(chip.textContent!)).toBeInTheDocument();
    }
  });
});
