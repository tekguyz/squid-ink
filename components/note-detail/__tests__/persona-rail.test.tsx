import { afterEach, describe, it, expect, vi } from "vitest";
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
  locked: false,
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

describe("PersonaRail — locked", () => {
  it("disables every lens once the note is frozen", () => {
    render(<PersonaRail {...base} locked onSelect={vi.fn()} />);
    for (const name of ["Neutral Analyst", "Sales Coach", "Investor"]) {
      expect(screen.getByRole("tab", { name })).toBeDisabled();
    }
  });

  it("does not report a selection when a locked lens is clicked", async () => {
    // The client-side half of the lock. The Server Action's guard is the half
    // that enforces it — this only stops a round trip that would be refused.
    const onSelect = vi.fn();
    render(<PersonaRail {...base} locked onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still reports which lens generated the note", () => {
    // Locked is not hidden. The rail's job when frozen is to state the truth
    // about how this note was generated, which is why the selected lens keeps
    // its full-contrast treatment rather than dimming with the rest.
    render(<PersonaRail {...base} locked selectedId="investor" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Investor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Neutral Analyst" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("is fully interactive while the note is still selectable", async () => {
    const onSelect = vi.fn();
    render(<PersonaRail {...base} locked={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(onSelect).toHaveBeenCalledWith("investor");
  });

  it("still lists the quick actions when locked", () => {
    // Quick actions are not persona selection and are out of this lock's
    // scope — they act on the note as generated.
    render(<PersonaRail {...base} locked onSelect={vi.fn()} />);
    expect(screen.getByText("Extract decisions only")).toBeInTheDocument();
  });

  // Issue #91: below 768px the lens tabs sit in a row that scrolls sideways,
  // so the chosen lens can start past its right edge. jsdom has no layout:
  // the row's width and each box are answered by hand.
  describe("on a phone, the chosen lens in the sideways row", () => {
    const row = () => screen.getByRole("tablist").parentElement as HTMLElement;

    function layOut(chosen: { left: number; right: number }) {
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = this.matches('[role="tab"][aria-selected="true"]')
          ? chosen
          : { left: 0, right: 300 };
        return { ...box, top: 0, bottom: 40, width: box.right - box.left, height: 40, x: box.left, y: 0, toJSON() {} };
      });
    }

    afterEach(() => vi.restoreAllMocks());

    it("scrolls the row so a lens past the right edge shows", () => {
      layOut({ left: 500, right: 620 });
      render(<PersonaRail {...base} selectedId="investor" onSelect={vi.fn()} />);
      expect(row().scrollLeft).toBe(320);
    });

    it("leaves the row alone when the chosen lens already shows", () => {
      layOut({ left: 60, right: 180 });
      render(<PersonaRail {...base} onSelect={vi.fn()} />);
      expect(row().scrollLeft).toBe(0);
    });
  });

  // Issue #91: below 768px the rail opens with a masthead, not a link band.
  it("gives a phone a way back and a menu", () => {
    render(<PersonaRail {...base} onSelect={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Back to all notes" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });
});
