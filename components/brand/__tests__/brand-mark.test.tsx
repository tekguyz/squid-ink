import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark, QUOTE_PATH } from "../brand-mark";

describe("BrandMark", () => {
  it("draws the same quote as the icon script", () => {
    const script = readFileSync("scripts/brand-icons.mjs", "utf8");
    expect(script).toContain(`"${QUOTE_PATH}"`);
  });

  it("is hidden from screen readers and sized by prop", () => {
    const { container } = render(<BrandMark size={16} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("16");
  });

  it("uses token classes only", () => {
    const { container } = render(<BrandMark />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|oklch|rgb\(/i);
  });
});
