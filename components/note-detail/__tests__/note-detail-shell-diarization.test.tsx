import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoteDetailShell } from "../note-detail-shell";
import { mockNote } from "@/lib/mock/note";

// Same stubs as note-detail-shell-persona.test.tsx: none of these are under test.
vi.mock("@/app/notes/actions/persona", () => ({
  seedNotePersona: vi.fn(async () => "written" as const),
  setNotePersona: vi.fn(async () => "written" as const),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], sendMessage: vi.fn(), status: "ready", error: undefined }),
}));
vi.mock("@/app/notes/actions/transcription", () => ({
  triggerTranscription: vi.fn(async () => "started" as const),
}));

// #13: a plain transcript has no speakers, so every turn is "Unknown". A
// Per-speaker card for "Unknown" at 100% talk is data that does not exist.
describe("NoteDetailShell per-speaker panel", () => {
  it("renders for a diarized note", () => {
    render(<NoteDetailShell note={{ ...mockNote, hasSpeakerLabels: true }} history={[]} />);
    expect(screen.getByText("Per-speaker")).toBeInTheDocument();
  });

  it("is absent for a note transcribed without speaker labels", () => {
    render(<NoteDetailShell note={{ ...mockNote, hasSpeakerLabels: false }} history={[]} />);
    expect(screen.queryByText("Per-speaker")).not.toBeInTheDocument();
  });
});
