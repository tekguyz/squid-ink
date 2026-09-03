import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../chat-panel";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import type { ChatTurn } from "@/lib/chat/types";

/** useChat owns a transport and a fetch. None of the assertions below are
 *  about the network, so it is stubbed and `sendMessage` is observed instead.
 *  Ported from the old chat-composer test — the draft/disabled/clear
 *  behaviour it covered is unchanged and worth keeping. */
const sendMessage = vi.fn();
let chatState: Record<string, unknown> = {};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: "ready",
    error: undefined,
    ...chatState,
  }),
}));

const segments = [
  { id: 8, time: "04:12" },
  { id: 9, time: "05:30" },
];

const base = {
  noteId: "note-1",
  personaLabel: "Neutral Analyst",
  history: [] as ChatTurn[],
  segments,
  activeSegmentId: 8,
};

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
  id: "t1",
  role: "assistant",
  content: "They agreed [[cite:t9]].",
  scope: "this_note",
  citations: [],
  createdAt: "2026-09-03T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  sendMessage.mockClear();
  chatState = {};
});

describe("ChatPanel — the composer", () => {
  it("starts empty with submission disabled", () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /ask/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();
  });

  it("records what the user types and enables submission", async () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.type(box, "Who owns the SOW?");
    expect(box).toHaveValue("Who owns the SOW?");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeEnabled();
  });

  it("stays disabled for whitespace only", async () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: /ask/i }), "   ");
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();
  });

  it("sends and clears the draft", async () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.type(box, "Who owns the SOW?{Enter}");
    expect(sendMessage).toHaveBeenCalledWith({ text: "Who owns the SOW?" });
    expect(box).toHaveValue("");
  });

  it("shows which lens is answering", () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    expect(screen.getByText("Neutral Analyst")).toBeInTheDocument();
  });

  it("refuses an over-length draft in the client too", async () => {
    // The route is the enforcement; this stops the request being made at all.
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.click(box);
    await userEvent.paste("x".repeat(MAX_MESSAGE_CHARS + 1));

    expect(screen.getByRole("button", { name: /^ask$/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/too long/i);
    expect(box).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ChatPanel — scope", () => {
  it("starts on this note and switches to all notes", async () => {
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    const thisNote = screen.getByRole("radio", { name: "This note" });
    const allNotes = screen.getByRole("radio", { name: "All notes" });

    expect(thisNote).toBeChecked();
    expect(allNotes).not.toBeChecked();

    await userEvent.click(allNotes);
    expect(allNotes).toBeChecked();
    expect(screen.getByRole("textbox", { name: /ask all notes/i })).toBeInTheDocument();
  });
});

describe("ChatPanel — persisted history", () => {
  it("renders a turn read back from the database", () => {
    render(
      <ChatPanel
        {...base}
        history={[turn({ role: "user", content: "who owns it?" })]}
        onCitationSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("who owns it?")).toBeInTheDocument();
  });

  it("makes a this-note citation clickable", async () => {
    const onCitationSelect = vi.fn();
    render(
      <ChatPanel {...base} history={[turn()]} onCitationSelect={onCitationSelect} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /05:30/ }));
    expect(onCitationSelect).toHaveBeenCalledWith(9);
  });

  it("renders a cross-note citation as a link to the other note", () => {
    render(
      <ChatPanel
        {...base}
        history={[
          turn({
            content: "They agreed [[cite:c1]].",
            scope: "all_notes",
            citations: [
              {
                key: "c1",
                chunkId: "ch-1",
                noteId: "n-2",
                noteTitle: "Pricing sync",
                chunkType: "transcript_segment",
                tsStart: "04:12",
              },
            ],
          }),
        ]}
        onCitationSelect={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: /Pricing sync 04:12/ });
    expect(link).toHaveAttribute("href", "/notes/n-2");
  });

  it("shows the ungrounded notice when every citation is dead", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The cited note was deleted — the state verify-chat-rls.mjs proof 5
    // leaves behind. The prose still shows; it just must not read as sourced.
    render(
      <ChatPanel
        {...base}
        history={[turn({ content: "They agreed [[cite:c1]].", citations: [] })]}
        onCitationSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/They agreed/)).toBeInTheDocument();
    expect(screen.getByText(/sources unavailable/i)).toBeInTheDocument();
  });
});

describe("ChatPanel — in-flight states", () => {
  it("announces a search while the tool is running", () => {
    chatState = {
      status: "streaming",
      messages: [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "tool-searchNotes", state: "input-available" }],
        },
      ],
    };
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);

    const status = screen.getByText(/searching your notes/i);
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("stops announcing once the tool has answered", () => {
    chatState = {
      messages: [
        {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-searchNotes",
              state: "output-available",
              output: { results: [] },
            },
            { type: "text", text: "Nothing in your notes matches that." },
          ],
        },
      ],
    };
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);

    expect(screen.queryByText(/searching your notes/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/nothing in your notes matches that/i),
    ).toBeInTheDocument();
  });

  it("shows a banner for a pipeline error, which an empty search is not", () => {
    chatState = { error: new Error("boom") };
    render(<ChatPanel {...base} onCitationSelect={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/went wrong/i);
  });
});
