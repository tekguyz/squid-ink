import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonasShell } from "../personas-shell";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import type { PersonasScreen } from "@/lib/notes/get-personas-screen";

const screenData: PersonasScreen = {
  personas: [
    {
      id: "neutral-analyst",
      name: "Neutral Analyst",
      sub: "dense · no framing",
      depth: "dense",
      actions: ["Extract decisions only", "Timeline of blockers"],
    },
    {
      id: "investor",
      name: "Investor",
      sub: "economics · risk",
      depth: "exhaustive",
      actions: ["Unit economics read"],
    },
  ],
  lastNoteId: "note-1",
  lastNoteTitle: "Pricing call",
  previews: { "neutral-analyst": { text: "Pricing moved per-clinic", time: "03:31" } },
};

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("PersonasShell", () => {
  it("opens on the neutral lens and marks only it selected", () => {
    render(<PersonasShell screen={screenData} />);
    expect(tab(/Neutral Analyst/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Investor/)).toHaveAttribute("aria-selected", "false");
  });

  it("renders each row's sub line from the data, not a hardcoded string", () => {
    render(<PersonasShell screen={screenData} />);
    expect(screen.getByText("economics · risk")).toBeInTheDocument();
  });

  it("shows the lens framing lib/notegen/lens-prompts.ts owns", () => {
    render(<PersonasShell screen={screenData} />);
    expect(
      screen.getByText(lensPromptFor("neutral-analyst").framing),
    ).toBeInTheDocument();
  });

  it("switches the pane when another lens is picked", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(tab(/Investor/));
    expect(screen.getByRole("heading", { name: "Investor" })).toBeInTheDocument();
    expect(
      screen.getByText(lensPromptFor("investor").framing),
    ).toBeInTheDocument();
    expect(screen.getByText("Unit economics read")).toBeInTheDocument();
  });

  it("shows a real takeaway as the preview, and never invents one", () => {
    render(<PersonasShell screen={screenData} />);
    expect(screen.getByText(/Pricing moved per-clinic/)).toBeInTheDocument();
    expect(screen.getByText("03:31")).toBeInTheDocument();
  });

  it("says a lens has not run rather than showing an example", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(tab(/Investor/));
    expect(screen.getByText(/has not run on/)).toBeInTheDocument();
    expect(screen.queryByText(/Pricing moved per-clinic/)).toBeNull();
  });

  it("says there is no note at all when the account has none", () => {
    render(
      <PersonasShell
        screen={{ ...screenData, lastNoteId: null, lastNoteTitle: null, previews: {} }}
      />,
    );
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
  });

  it("renders every unbuilt control disabled rather than hiding it", () => {
    render(<PersonasShell screen={screenData} />);
    for (const name of [/New persona/, /Duplicate/, /Set as default/, /Add quick action/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("shows the persona's depth without offering to change it", () => {
    render(<PersonasShell screen={screenData} />);
    const dense = screen.getByRole("button", { name: "dense" });
    expect(dense).toHaveAttribute("aria-pressed", "true");
    expect(dense).toBeDisabled();
    expect(screen.getByRole("button", { name: "brief" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("falls back to the first lens when the account has no neutral row", () => {
    render(
      <PersonasShell
        screen={{ ...screenData, personas: [screenData.personas[1]] }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Investor" })).toBeInTheDocument();
  });
});
