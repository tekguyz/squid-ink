import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Issue #23. Each pane on a note hides to a strip and comes back; the note
// itself never hides. jsdom has no layout and no Tailwind, so "visible" here
// is the `hidden` attribute the shell sets once it knows the state — the
// widths are proved in real Chrome by scripts/verify-layout.mjs.

const renderShell = () =>
  render(<NoteDetailShell note={mockNote} history={[]} />);

// A hidden element has no accessible name, so the panes are found by the id
// their buttons' aria-controls point at.
const pane = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no #${id}`);
  return element;
};
const transcript = () => pane("transcript-pane");
const lensTabs = () => pane("lens-pane");
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-pane-lens");
  document.documentElement.removeAttribute("data-pane-transcript");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hiding and showing a pane by button", () => {
  it("shows both panes by default", () => {
    renderShell();
    expect(transcript()).toBeVisible();
    expect(lensTabs()).toBeVisible();
    expect(button("Hide transcript")).toHaveAttribute("aria-expanded", "true");
    expect(button("Hide lens rail")).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the transcript to a strip and brings it back", async () => {
    renderShell();
    await userEvent.click(button("Hide transcript"));
    expect(transcript()).not.toBeVisible();
    const show = button("Show transcript");
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show).toHaveAttribute("aria-controls", transcript().id);

    await userEvent.click(show);
    expect(transcript()).toBeVisible();
    expect(button("Hide transcript")).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the lens rail to a strip and brings it back", async () => {
    renderShell();
    await userEvent.click(button("Hide lens rail"));
    expect(lensTabs()).not.toBeVisible();
    await userEvent.click(button("Show lens rail"));
    expect(lensTabs()).toBeVisible();
  });

  it("hides both, and the note stays", async () => {
    renderShell();
    await userEvent.click(button("Hide transcript"));
    await userEvent.click(button("Hide lens rail"));
    expect(screen.getByRole("main")).toBeVisible();
    expect(button("Show transcript")).toBeVisible();
    expect(button("Show lens rail")).toBeVisible();
  });
});

describe("the keys", () => {
  it("] toggles the transcript and [ toggles the lens rail", async () => {
    renderShell();
    await userEvent.keyboard("]");
    expect(transcript()).not.toBeVisible();
    await userEvent.keyboard("[[");
    expect(lensTabs()).not.toBeVisible();
    await userEvent.keyboard("]");
    expect(transcript()).toBeVisible();
    await userEvent.keyboard("[[");
    expect(lensTabs()).toBeVisible();
  });

  it("types the character inside the chat box instead", async () => {
    renderShell();
    const chat = screen.getByRole("textbox", { name: /ask/i });
    await userEvent.type(chat, "[[]");
    expect(chat).toHaveValue("[]");
    expect(transcript()).toBeVisible();
    expect(lensTabs()).toBeVisible();
  });

  it("types the character inside the tag field instead", async () => {
    renderShell();
    const tags = screen.getByRole("textbox", { name: /tag/i });
    await userEvent.type(tags, "]");
    expect(transcript()).toBeVisible();
  });

  it("does nothing while Ctrl, Alt or Meta is held", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}]{/Control}");
    await userEvent.keyboard("{Alt>}]{/Alt}");
    await userEvent.keyboard("{Meta>}[[{/Meta}");
    expect(transcript()).toBeVisible();
    expect(lensTabs()).toBeVisible();
  });
});

describe("remembering the choice", () => {
  it("survives a remount", async () => {
    const first = renderShell();
    await userEvent.click(button("Hide transcript"));
    first.unmount();
    // A reload clears the root; the saved value is what brings it back.
    document.documentElement.removeAttribute("data-pane-transcript");

    renderShell();
    expect(transcript()).not.toBeVisible();
    expect(button("Show transcript")).toHaveAttribute("aria-expanded", "false");
    expect(lensTabs()).toBeVisible();
  });

  it("renders both panes shown when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    renderShell();
    expect(transcript()).toBeVisible();
    expect(lensTabs()).toBeVisible();
    // A blocked store still lets the reader hide a pane for this visit.
    await userEvent.click(button("Hide transcript"));
    expect(transcript()).not.toBeVisible();
  });
});

describe("a citation into a hidden transcript", () => {
  it("opens the pane without changing the saved choice", async () => {
    const first = renderShell();
    await userEvent.click(button("Hide transcript"));
    await userEvent.click(screen.getAllByRole("button", { name: /Jump to transcript at/ })[0]);
    expect(transcript()).toBeVisible();

    // The next note still opens the way the reader set it.
    first.unmount();
    renderShell();
    expect(transcript()).not.toBeVisible();
  });
});
