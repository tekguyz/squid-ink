import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeBoot } from "../theme-boot";

function bootScript(container: HTMLElement) {
  const script = container.querySelector("script");
  if (!script) throw new Error("ThemeBoot rendered no <script>");
  return script;
}

/** Runs the script text as the browser would, on a clean <html>. Mounting
 *  already applied the theme, so the class is cleared first — otherwise this
 *  would measure the effect, not the script. */
function runBootScript(container: HTMLElement) {
  document.documentElement.classList.remove("light", "dark");
  new Function(bootScript(container).textContent ?? "")();
}

const root = () => document.documentElement.classList;

describe("ThemeBoot", () => {
  afterEach(() => {
    localStorage.clear();
    root().remove("light", "dark");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // React skips its "Encountered a script tag" warning for a script whose type
  // is not JavaScript. The warning itself cannot be asserted here: it exists
  // only in Next's compiled react-dom, not the react-dom this suite renders
  // with. The dev server is where it is proved absent.
  it("is inert on the client, so React does not warn about it", () => {
    const { container } = render(<ThemeBoot />);
    expect(bootScript(container)).toHaveAttribute("type", "text/plain");
  });

  it("applies a saved dark theme to <html>", () => {
    localStorage.setItem("theme", "dark");
    const { container } = render(<ThemeBoot />);
    runBootScript(container);
    expect(root().contains("dark")).toBe(true);
  });

  it("applies a saved light theme over a dark OS setting", () => {
    localStorage.setItem("theme", "light");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<ThemeBoot />);
    runBootScript(container);
    expect(root().contains("light")).toBe(true);
    expect(root().contains("dark")).toBe(false);
  });

  // A notFound() after the shell has streamed makes React client-render the
  // root layout, which resets <html> to its JSX className and drops the class
  // the script set. Measured 2026-09-23: a saved "light" on a dark OS painted
  // the 404 dark. The inert client copy cannot help, so mounting re-applies.
  it("re-applies a saved theme when mounted, without running the script", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeBoot />);
    expect(root().contains("dark")).toBe(true);
  });

  // .dark wins over .light in globals.css, so a stale "dark" left beside a
  // saved "light" (another tab changed it) would keep the page dark.
  it("replaces a stale opposite class instead of adding beside it", () => {
    root().add("dark");
    localStorage.setItem("theme", "light");
    render(<ThemeBoot />);
    expect(root().contains("light")).toBe(true);
    expect(root().contains("dark")).toBe(false);
  });
});
