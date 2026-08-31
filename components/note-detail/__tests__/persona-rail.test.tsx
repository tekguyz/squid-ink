import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonaRail } from "../persona-rail";
import { mockNote } from "@/lib/mock/note";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

const base = {
  personas: mockNote.personas,
  selectedId: DEFAULT_PERSONA_ID,
  quickActions: mockNote.personas[0].actions,
  spansLinked: mockNote.spansLinked,
};

describe("PersonaRail", () => {
  it("marks only the selected lens as selected", () => {
    render(<PersonaRail {...base} onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Neutral Analyst" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Investor" })).toHaveAttribute("aria-selected", "false");
  });

  it("reports the lens the user picks", async () => {
    const onSelect = vi.fn();
    render(<PersonaRail {...base} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(onSelect).toHaveBeenCalledWith("investor");
  });

  it("moves the selection when the caller changes it", () => {
    const { rerender } = render(<PersonaRail {...base} onSelect={vi.fn()} />);
    rerender(<PersonaRail {...base} selectedId="investor" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Investor" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Neutral Analyst" })).toHaveAttribute("aria-selected", "false");
  });

  it("lists the quick actions it was given", () => {
    render(<PersonaRail {...base} onSelect={vi.fn()} />);
    expect(screen.getByText("Extract decisions only")).toBeInTheDocument();
    expect(screen.getByText("Diff against last call")).toBeInTheDocument();
  });

  it("swaps the quick actions when a different lens supplies them", () => {
    const investor = mockNote.personas.find((p) => p.id === "investor")!;
    render(
      <PersonaRail {...base} selectedId="investor" quickActions={investor.actions} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Unit-economics read")).toBeInTheDocument();
    expect(screen.queryByText("Extract decisions only")).not.toBeInTheDocument();
  });

  it("shows how many spans are grounded", () => {
    render(<PersonaRail {...base} onSelect={vi.fn()} />);
    expect(screen.getByText("27 spans linked")).toBeInTheDocument();
  });
});
