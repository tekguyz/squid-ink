import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonasShell } from "../personas-shell";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { MAX_QUICK_ACTIONS } from "@/lib/notes/persona-config";
import type { PersonasScreen } from "@/lib/notes/get-personas-screen";

/** The Server Actions, stubbed. This file is about what the screen SENDS, not
 *  about what the actions do with it — app/notes/actions/__tests__ owns that,
 *  and importing the real module here would drag next/cache and the Supabase
 *  server client into jsdom for no gain. */
const actions = vi.hoisted(() => ({
  setPersonaDepth: vi.fn(async () => "written" as const),
  addQuickAction: vi.fn(async () => "written" as const),
  removeQuickAction: vi.fn(async () => "written" as const),
  setDefaultPersona: vi.fn(async () => "written" as const),
}));

vi.mock("@/app/notes/actions/configure-persona", () => actions);

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
  defaultPersonaId: "neutral-analyst",
};

const tab = (name: RegExp) => screen.getByRole("tab", { name });

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear();
});

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

  it("keeps authoring controls disabled rather than hiding them", () => {
    // Creating and duplicating a persona are Advanced-phase, ROADMAP §8, and
    // nothing on this screen deletes one. Configuring the four provisioned
    // rows is a different job from authoring a fifth.
    render(<PersonasShell screen={screenData} />);
    for (const name of [/New persona/, /Duplicate/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
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

describe("PersonasShell — depth", () => {
  it("marks the row's own depth and offers the other two", () => {
    render(<PersonasShell screen={screenData} />);
    expect(screen.getByRole("button", { name: "dense" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const brief = screen.getByRole("button", { name: "brief" });
    expect(brief).toHaveAttribute("aria-pressed", "false");
    expect(brief).toBeEnabled();
  });

  it("sends the slug and the chosen depth", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(screen.getByRole("button", { name: "exhaustive" }));
    expect(actions.setPersonaDepth).toHaveBeenCalledWith(
      "neutral-analyst",
      "exhaustive",
    );
  });

  it("names the refusal instead of silently snapping back", async () => {
    actions.setPersonaDepth.mockResolvedValueOnce("no-persona" as never);
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(screen.getByRole("button", { name: "brief" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no such lens/i);
  });
});

describe("PersonasShell — quick actions", () => {
  it("shows the cap up front, not on the seventh attempt", () => {
    render(<PersonasShell screen={screenData} />);
    expect(screen.getByText(`2 of ${MAX_QUICK_ACTIONS}`)).toBeInTheDocument();
  });

  it("sends the typed text", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.type(
      screen.getByLabelText("New quick action"),
      "Unanswered questions",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(actions.addQuickAction).toHaveBeenCalledWith(
      "neutral-analyst",
      "Unanswered questions",
    );
  });

  it("removes by text, never by index", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove quick action: Timeline of blockers" }),
    );
    expect(actions.removeQuickAction).toHaveBeenCalledWith(
      "neutral-analyst",
      "Timeline of blockers",
    );
  });

  it("closes the add control at the cap and says why", () => {
    render(
      <PersonasShell
        screen={{
          ...screenData,
          personas: [
            {
              ...screenData.personas[0],
              actions: Array.from(
                { length: MAX_QUICK_ACTIONS },
                (_, i) => `Action ${i}`,
              ),
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText(`${MAX_QUICK_ACTIONS} of ${MAX_QUICK_ACTIONS}`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New quick action")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});

describe("PersonasShell — the default lens", () => {
  it("reports the current default rather than offering to re-set it", () => {
    render(<PersonasShell screen={screenData} />);
    const button = screen.getByRole("button", { name: "Default" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("sends the SLUG of another lens, never a uuid", async () => {
    render(<PersonasShell screen={screenData} />);
    await userEvent.click(tab(/Investor/));
    await userEvent.click(screen.getByRole("button", { name: "Set as default" }));
    expect(actions.setDefaultPersona).toHaveBeenCalledWith("investor");
  });
});
