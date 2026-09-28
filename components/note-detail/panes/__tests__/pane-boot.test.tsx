import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PaneBoot } from "../pane-boot";

// Same shape as components/__tests__/theme-boot.test.tsx: the script text is
// run as the browser would, on a clean <html>.
function runBootScript(container: HTMLElement) {
  const script = container.querySelector("script");
  if (!script) throw new Error("PaneBoot rendered no <script>");
  new Function(script.textContent ?? "")();
}

const root = () => document.documentElement;

describe("PaneBoot", () => {
  afterEach(() => {
    localStorage.clear();
    root().removeAttribute("data-pane-lens");
    root().removeAttribute("data-pane-transcript");
    vi.restoreAllMocks();
  });

  it("is inert on the client, so React does not warn about it", () => {
    const { container } = render(<PaneBoot />);
    expect(container.querySelector("script")).toHaveAttribute("type", "text/plain");
  });

  it("puts a saved hidden pane on <html>", () => {
    localStorage.setItem("pane:transcript", "hidden");
    const { container } = render(<PaneBoot />);
    runBootScript(container);
    expect(root()).toHaveAttribute("data-pane-transcript", "hidden");
    expect(root()).not.toHaveAttribute("data-pane-lens");
  });

  it("leaves both panes shown when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { container } = render(<PaneBoot />);
    expect(() => runBootScript(container)).not.toThrow();
    expect(root()).not.toHaveAttribute("data-pane-lens");
    expect(root()).not.toHaveAttribute("data-pane-transcript");
  });
});
