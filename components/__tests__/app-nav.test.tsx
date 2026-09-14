import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppNav } from "../app-nav";

describe("AppNav", () => {
  it("links to all four main screens", () => {
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "All notes" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Personas" })).toHaveAttribute("href", "/personas");
    expect(screen.getByRole("link", { name: "Collections" })).toHaveAttribute(
      "href",
      "/collections",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("marks only the current screen", () => {
    render(<AppNav current="personas" />);
    expect(screen.getByRole("link", { name: "Personas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("marks nothing on a note page", () => {
    render(<AppNav />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
