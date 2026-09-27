import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TagEntry } from "@/components/tags/tag-entry";
import { CollectionPicker } from "@/components/collections/collection-picker";
import { DemoMode, DemoOffNote } from "@/components/demo/demo-mode";
import { NOTE_WRITES_DEMO_OFF } from "@/lib/auth/demo-visitor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/notes/actions/tags", () => ({ addNoteTag: vi.fn(), removeNoteTag: vi.fn() }));
vi.mock("@/app/notes/actions/collections", () => ({
  addNoteToCollection: vi.fn(),
  removeNoteFromCollection: vi.fn(),
}));

const OFF = "Not available in the demo.";
const TAG = { id: "t1", name: "pricing", token: "tag-1" } as never;
const COLLECTION = { id: "c1", name: "Clients" } as never;

/** Issue #19: the note's tag and collection controls, turned off for a demo
 *  visitor and unchanged for everyone else. Both point at ONE note, which
 *  note-detail-shell renders under them; the tests render it beside them. */
describe("note actions in the demo", () => {
  it("turns off tagging and says why", () => {
    render(
      <DemoMode demo>
        <TagEntry noteId="n1" tags={[TAG]} />
        <DemoOffNote id={NOTE_WRITES_DEMO_OFF} />
      </DemoMode>,
    );
    for (const control of [
      screen.getByRole("textbox", { name: "Add a tag" }),
      screen.getByRole("button", { name: "Remove tag pricing" }),
    ]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAccessibleDescription(OFF);
    }
  });

  it("turns off filing and says why", () => {
    render(
      <DemoMode demo>
        <CollectionPicker noteId="n1" collections={[COLLECTION]} options={[]} />
        <DemoOffNote id={NOTE_WRITES_DEMO_OFF} />
      </DemoMode>,
    );
    for (const control of [
      screen.getByRole("combobox", { name: "File this note in a collection" }),
      screen.getByRole("button", { name: "Remove from Clients" }),
    ]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAccessibleDescription(OFF);
    }
  });

  it("leaves both live outside the demo", () => {
    render(
      <>
        <TagEntry noteId="n1" tags={[]} />
        <CollectionPicker noteId="n1" collections={[]} options={[]} />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Add a tag" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "File this note in a collection" })).toBeEnabled();
    expect(screen.queryByText(OFF)).toBeNull();
  });
});
