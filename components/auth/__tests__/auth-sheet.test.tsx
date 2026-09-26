import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthSheet } from "../auth-sheet";

describe("AuthSheet", () => {
  it("links the mark back to the landing page, so /login is never a dead end (#60)", () => {
    render(<AuthSheet>form</AuthSheet>);

    expect(screen.getByRole("link", { name: "Squid Ink" })).toHaveAttribute("href", "/");
  });
});
