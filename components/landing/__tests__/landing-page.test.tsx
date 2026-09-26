import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LandingPage } from "../landing-page";

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

  it("has no demo button until the demo ships (#19)", () => {
    render(<LandingPage />);

    expect(screen.queryByRole("button", { name: /demo/i })).toBeNull();
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
