import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollectionCreate } from "../collection-create";
import { DemoMode } from "@/components/demo/demo-mode";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/notes/actions/collections", () => ({ createCollection: vi.fn() }));

/** Issue #19: a demo visitor opens Collections with none, and cannot make one. */
describe("CollectionCreate in the demo", () => {
  it("turns the field off and says why", () => {
    render(
      <DemoMode demo>
        <CollectionCreate />
      </DemoMode>,
    );
    const field = screen.getByRole("textbox", { name: "New collection name" });
    expect(field).toBeDisabled();
    expect(field).toHaveAccessibleDescription("Not available in the demo.");
  });

  it("is unchanged outside the demo", () => {
    render(<CollectionCreate />);
    expect(screen.getByRole("textbox", { name: "New collection name" })).toBeEnabled();
    expect(screen.queryByText("Not available in the demo.")).toBeNull();
  });
});
