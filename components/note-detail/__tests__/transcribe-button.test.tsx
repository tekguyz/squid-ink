import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranscribeButton } from "../transcribe-button";

const transcribeNote = vi.fn();
vi.mock("@/app/notes/actions", () => ({
  transcribeNote: (id: string) => transcribeNote(id),
}));

const NOTE = "11111111-2222-3333-4444-555555555555";

/** Resolves only when the test says so, so the in-flight state can be observed
 *  rather than raced. A long recording can hold this action open for the whole
 *  Vercel function ceiling — the button must look busy for all of it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const button = () => screen.getByRole("button", { name: /transcrib/i });

describe("TranscribeButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transcribeNote.mockResolvedValue({ status: "transcribed" });
  });

  describe("when the note is eligible", () => {
    it("offers the action for a note still at 'uploading'", () => {
      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      expect(button()).toBeEnabled();
    });

    it("offers a retry for a note at 'failed'", () => {
      render(<TranscribeButton noteId={NOTE} status="failed" />);
      expect(button()).toBeEnabled();
    });

    it("is a real button element, not a clickable div", () => {
      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      expect(button().tagName).toBe("BUTTON");
      expect(button()).toHaveAttribute("type", "button");
    });

    it("passes the note id to the action", async () => {
      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());
      expect(transcribeNote).toHaveBeenCalledWith(NOTE);
    });
  });

  describe("when the note is not eligible", () => {
    // A completed note has a transcript; an analyzing one already has a
    // transcription behind it. Neither is a thing to offer.
    it.each(["completed", "analyzing", "local"] as const)(
      "renders nothing at '%s'",
      (status) => {
        const { container } = render(
          <TranscribeButton noteId={NOTE} status={status} />,
        );
        expect(container).toBeEmptyDOMElement();
      },
    );
  });

  describe("while the action is in flight", () => {
    it("disables itself so the same row cannot be claimed twice", async () => {
      const pending = deferred<{ status: string }>();
      transcribeNote.mockReturnValue(pending.promise);

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      await waitFor(() => expect(button()).toBeDisabled());
      pending.resolve({ status: "transcribed" });
    });

    it("says it is working, and says it can take a while", async () => {
      const pending = deferred<{ status: string }>();
      transcribeNote.mockReturnValue(pending.promise);

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      await waitFor(() => expect(button()).toHaveTextContent(/transcribing/i));
      expect(screen.getByRole("status")).toHaveTextContent(/minutes|a while/i);
      pending.resolve({ status: "transcribed" });
    });

    it("announces the busy state to assistive technology", async () => {
      const pending = deferred<{ status: string }>();
      transcribeNote.mockReturnValue(pending.promise);

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      await waitFor(() => expect(button()).toHaveAttribute("aria-busy", "true"));
      pending.resolve({ status: "transcribed" });
    });
  });

  describe("when the action fails", () => {
    it("shows the message and re-enables, rather than sitting stuck", async () => {
      transcribeNote.mockRejectedValue(new Error("GEMINI_API_KEY is unset"));

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      expect(await screen.findByRole("status")).toHaveTextContent(
        /GEMINI_API_KEY is unset/,
      );
      expect(button()).toBeEnabled();
    });

    it("reports a transcription that ran and failed", async () => {
      transcribeNote.mockResolvedValue({ status: "failed" });

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      expect(await screen.findByRole("status")).toHaveTextContent(
        /could not be transcribed/i,
      );
      expect(button()).toBeEnabled();
    });

    // Zero rows matched is not an error anywhere else in this pipeline, and it
    // must not read as one here either — the cron simply got there first.
    it("reads a lost claim as information, not failure", async () => {
      transcribeNote.mockResolvedValue({ status: "not-eligible" });

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());

      expect(await screen.findByRole("status")).toHaveTextContent(
        /already/i,
      );
      expect(button()).toBeEnabled();
    });

    it("clears a stale message when the action is pressed again", async () => {
      transcribeNote.mockResolvedValue({ status: "failed" });

      render(<TranscribeButton noteId={NOTE} status="uploading" />);
      await userEvent.click(button());
      await screen.findByRole("status");

      const pending = deferred<{ status: string }>();
      transcribeNote.mockReturnValue(pending.promise);
      await userEvent.click(button());

      await waitFor(() =>
        expect(screen.getByRole("status")).not.toHaveTextContent(
          /could not be transcribed/i,
        ),
      );
      pending.resolve({ status: "transcribed" });
    });
  });
});
