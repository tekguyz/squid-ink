import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CitationChip } from "../citation-chip";

describe("CitationChip", () => {
  it("calls onSelect with its segment id when clicked", async () => {
    const onSelect = vi.fn();
    render(<CitationChip time="00:58" segmentId={3} active={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /00:58/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("is activatable from the keyboard", async () => {
    const onSelect = vi.fn();
    render(<CitationChip time="03:31" segmentId={8} active={false} onSelect={onSelect} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(8);
  });

  it("reports its pressed state when active", () => {
    const { rerender } = render(
      <CitationChip time="04:12" segmentId={9} active={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<CitationChip time="04:12" segmentId={9} active onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button")).toHaveAttribute("data-active", "true");
  });

  it("names the destination for screen readers, not just the timestamp", () => {
    render(<CitationChip time="00:58" segmentId={3} active={false} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Jump to transcript at 00:58" }),
    ).toBeInTheDocument();
  });

  it("still reports its segment when drawn bare", async () => {
    const onSelect = vi.fn();
    render(
      <CitationChip time="04:48" segmentId={10} active={false} variant="bare" onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /04:48/ }));
    expect(onSelect).toHaveBeenCalledWith(10);
  });
});
