import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TranscriptPane } from "../transcript-pane";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { mockNote } from "@/lib/mock/note";

/**
 * #58: the pane is the right column, so its scroll list ran to the viewport
 * bottom and the Record HUD sat on its last lines. The list must END above a
 * HUD_RESERVE band, as the Dashboard's does. jsdom has no layout, so this
 * proves the structure; scripts/verify-layout.mjs proves the pixels.
 */
describe("TranscriptPane HUD band", () => {
  it("ends the scroll list above a HUD_RESERVE-tall band", () => {
    const scrollRef = createRef<HTMLDivElement>();
    render(<TranscriptPane note={mockNote} activeSegmentId={-1} scrollRef={scrollRef} />);

    const band = scrollRef.current?.nextElementSibling as HTMLElement | null;
    expect(band).not.toBeNull();
    expect(band?.style.height).toBe(HUD_RESERVE);
    expect(band).toHaveClass("flex-none");
    expect(band?.nextElementSibling).toBeNull();
  });
});
