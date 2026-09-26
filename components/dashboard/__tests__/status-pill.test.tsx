import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "@/components/dashboard/status-pill";

// jsdom paints nothing, so the fill is asserted as the token the pill wears.
// Its contrast in a real browser is scripts/verify-layout.mjs's job.
describe("StatusPill", () => {
  it("fills a Failed pill with the live tint, framed and labelled in live", () => {
    render(<StatusPill status="failed" />);
    const pill = screen.getByText("Failed");
    expect(pill).toHaveClass("bg-live-tint", "border-live", "text-live");
  });

  it("leaves the Transcribing pill on its own tint", () => {
    render(<StatusPill status="analyzing" />);
    const pill = screen.getByText("Transcribing");
    expect(pill).toHaveClass("bg-tint");
    expect(pill).not.toHaveClass("bg-live-tint");
  });
});
