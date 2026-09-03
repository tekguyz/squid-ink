import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteDetailShell } from "../note-detail-shell";
import { mockNote } from "@/lib/mock/note";
import type { Note } from "@/lib/notes/view-types";

const seedNotePersona = vi.hoisted(() => vi.fn(async () => "written" as const));
const setNotePersona = vi.hoisted(() => vi.fn(async () => "written" as const));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/app/notes/actions/persona", () => ({
  seedNotePersona,
  setNotePersona,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// The shell renders ChatPanel now. None of these tests are about chat, so
// useChat is stubbed rather than left to reach for a transport.
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    error: undefined,
  }),
}));

/** The note detail shell renders the Transcribe button and the audio player,
 *  both of which reach for browser APIs and their own actions. Neither is
 *  under test here. */
vi.mock("@/app/notes/actions/transcription", () => ({
  triggerTranscription: vi.fn(async () => "started" as const),
}));

const note = (over: Partial<Note>): Note => ({ ...mockNote, ...over });

/** A note still in the window where its lens can be chosen. */
const SELECTABLE = {
  personaId: null,
  notegenStatus: null,
  processingStatus: "uploading",
} as const;

beforeEach(() => {
  seedNotePersona.mockClear();
  setNotePersona.mockClear();
  refresh.mockClear();
});

describe("seeding the lens on mount", () => {
  it("seeds a fresh note that carries none", async () => {
    // A REAL write, not a visual default. The rail must never highlight a lens
    // the database does not actually hold.
    render(<NoteDetailShell note={note(SELECTABLE)} history={[]} />);
    await waitFor(() =>
      expect(seedNotePersona).toHaveBeenCalledWith(mockNote.id),
    );
  });

  it("does NOT seed a note that already has one", async () => {
    render(<NoteDetailShell note={note({ ...SELECTABLE, personaId: "investor" })} history={[]} />);
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });

  it("does NOT seed a note that already generated", async () => {
    // Writing a lens onto a note that generated under a different one would
    // make the rail lie — the exact failure this feature exists to prevent.
    render(
      <NoteDetailShell
        history={[]}
        note={note({
          personaId: null,
          notegenStatus: "completed",
          processingStatus: "completed",
        })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });

  it("does NOT seed once Transcribe has been pressed", async () => {
    // notegen_status is still null through the whole transcription. Seeding
    // here would write a lens the generation about to run might not use.
    render(
      <NoteDetailShell
        history={[]}
        note={note({
          personaId: null,
          notegenStatus: null,
          processingStatus: "analyzing",
        })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });

  it("seeds only once, not once per effect run", async () => {
    render(<NoteDetailShell note={note(SELECTABLE)} history={[]} />);
    await waitFor(() => expect(seedNotePersona).toHaveBeenCalled());
    expect(seedNotePersona).toHaveBeenCalledTimes(1);
  });
});

describe("choosing a lens", () => {
  it("writes the choice through the action, by slug", async () => {
    render(
      <NoteDetailShell note={note({ ...SELECTABLE, personaId: "neutral-analyst" })} history={[]} />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    await waitFor(() =>
      expect(setNotePersona).toHaveBeenCalledWith(mockNote.id, "investor"),
    );
  });

  it("shows the new lens immediately, before the server answers", async () => {
    render(
      <NoteDetailShell note={note({ ...SELECTABLE, personaId: "neutral-analyst" })} history={[]} />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(screen.getByRole("tab", { name: "Investor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("rolls the highlight back when the server refuses the write", async () => {
    // The rail must never show a lens the database does not hold, and a
    // 'locked' answer means the write did not land.
    setNotePersona.mockResolvedValueOnce("locked" as never);
    render(
      <NoteDetailShell note={note({ ...SELECTABLE, personaId: "neutral-analyst" })} history={[]} />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Neutral Analyst" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });

  it("cannot choose once the note is locked", async () => {
    render(
      <NoteDetailShell
        history={[]}
        note={note({
          personaId: "neutral-analyst",
          notegenStatus: "completed",
          processingStatus: "completed",
        })}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(setNotePersona).not.toHaveBeenCalled();
  });
});

describe("which lens the rail highlights", () => {
  it("shows the note's own lens", () => {
    render(<NoteDetailShell note={note({ ...SELECTABLE, personaId: "sales-coach" })} history={[]} />);
    expect(screen.getByRole("tab", { name: "Sales Coach" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to the default for a note with none", () => {
    // Every note written before 2026-09-02 is null and locked, and Neutral
    // Analyst is the truth about how it generated.
    render(
      <NoteDetailShell
        history={[]}
        note={note({
          personaId: null,
          notegenStatus: "completed",
          processingStatus: "completed",
        })}
      />,
    );
    expect(screen.getByRole("tab", { name: "Neutral Analyst" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
