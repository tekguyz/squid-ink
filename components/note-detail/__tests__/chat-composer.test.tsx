import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatComposer } from "../chat-composer";
import { mockNote } from "@/lib/mock/note";

const base = {
  personaLabel: "Neutral Analyst",
  question: mockNote.sampleExchange.question,
  answer: mockNote.sampleExchange.answer,
  activeSegmentId: 8,
};

describe("ChatComposer", () => {
  it("starts empty with submission disabled", () => {
    render(<ChatComposer {...base} onCitationSelect={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /ask/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();
  });

  it("records what the user types and enables submission", async () => {
    render(<ChatComposer {...base} onCitationSelect={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.type(box, "Who owns the SOW?");
    expect(box).toHaveValue("Who owns the SOW?");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeEnabled();
  });

  it("stays disabled for whitespace only", async () => {
    render(<ChatComposer {...base} onCitationSelect={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: /ask/i }), "   ");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();
  });

  it("clears the draft after submitting", async () => {
    render(<ChatComposer {...base} onCitationSelect={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.type(box, "Who owns the SOW?{Enter}");
    expect(box).toHaveValue("");
  });

  it("surfaces the citation inside the answer", async () => {
    const onCitationSelect = vi.fn();
    render(<ChatComposer {...base} onCitationSelect={onCitationSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /04:12/ }));
    expect(onCitationSelect).toHaveBeenCalledWith(9);
  });

  it("shows which lens is answering", () => {
    render(<ChatComposer {...base} onCitationSelect={vi.fn()} />);
    expect(screen.getByText("Neutral Analyst")).toBeInTheDocument();
  });
});
