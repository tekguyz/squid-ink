import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NotegenPending } from "@/components/note-detail/notegen-pending";

afterEach(cleanup);

describe("NotegenPending", () => {
  it("says the note is being written while generation has not finished", () => {
    render(
      <NotegenPending
        processing="completed"
        notegen={null}
        sectionsEmpty
        gaveUp={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/writing the note/i);
  });

  it("stays silent once the note is written", () => {
    render(
      <NotegenPending
        processing="completed"
        notegen="completed"
        sectionsEmpty={false}
        gaveUp={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stays silent when every section already has content", () => {
    render(
      <NotegenPending
        processing="completed"
        notegen="generating"
        sectionsEmpty={false}
        gaveUp={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stays silent before the transcript exists", () => {
    render(
      <NotegenPending
        processing="analyzing"
        notegen={null}
        sectionsEmpty
        gaveUp={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stops promising the text will appear once the poll gave up", () => {
    render(
      <NotegenPending
        processing="completed"
        notegen="generating"
        sectionsEmpty
        gaveUp
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/refresh to check/i);
  });
});
