import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthSheet } from "../auth-sheet";
import { PANEL_HEADLINE, PANEL_LINES } from "../brand-panel";

describe("BrandPanel (issue #89)", () => {
  it("ends with a plain link to the landing page, not a demo button", () => {
    render(<AuthSheet>form</AuthSheet>);

    expect(screen.getByRole("link", { name: "Just looking? See what it does →" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: /demo/i })).toBeNull();
  });

  it("writes no new copy: every line is on the landing page word for word", () => {
    const landing = readFileSync(join(process.cwd(), "components/landing/landing-page.tsx"), "utf8");
    const flat = landing.replace(/\s+/g, " ");

    for (const line of [PANEL_HEADLINE, ...PANEL_LINES]) {
      expect(flat).toContain(line.replace(/'/g, "’"));
    }
  });
});
