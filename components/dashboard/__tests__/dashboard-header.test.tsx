import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DemoMode, DemoOffNote } from "@/components/demo/demo-mode";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { RECORD_DEMO_OFF } from "@/lib/auth/demo-visitor";

/** Issue #19: the header's Record, turned off for a demo visitor. */
describe("DashboardHeader Record", () => {
  beforeEach(() => useRecorderStore.getState().discard());

  it("is turned off in the demo, and says why", async () => {
    const before = useRecorderStore.getState().startRequests;
    // The reason is the Record pill's note, which the layout's HUD renders.
    render(
      <DemoMode demo>
        <DashboardHeader />
        <DemoOffNote id={RECORD_DEMO_OFF} />
      </DemoMode>,
    );
    const record = screen.getByRole("button", { name: "Record" });
    expect(record).toHaveAttribute("aria-disabled", "true");
    expect(record).toHaveAccessibleDescription("Not available in the demo.");
    await userEvent.click(record);
    expect(useRecorderStore.getState().startRequests).toBe(before);
  });

  it("asks the recorder to start outside the demo", async () => {
    const before = useRecorderStore.getState().startRequests;
    render(<DashboardHeader />);
    const record = screen.getByRole("button", { name: "Record" });
    expect(record).toBeEnabled();
    await userEvent.click(record);
    expect(useRecorderStore.getState().startRequests).toBe(before + 1);
  });

  // #20: the choice opens in the HUD corner; the header says where.
  it("points at the mode choice while it is open", () => {
    useRecorderStore.getState().openChoice();
    render(<DashboardHeader />);
    expect(screen.getByRole("status")).toHaveTextContent(/choose a mode/i);
  });

  // #24: the same words as the HUD's waiting pill.
  it("says what the browser's prompt needs while it is open", () => {
    useRecorderStore.getState().requestStart("11111111-2222-3333-4444-555555555555", "meeting");
    render(<DashboardHeader />);
    expect(screen.getByRole("status")).toHaveTextContent("Choose a tab to share");
  });

  // #24: one "Saving" for the two internal steps, as the HUD shows.
  it("says Saving while a recording saves", () => {
    const s = useRecorderStore.getState();
    s.requestStart("11111111-2222-3333-4444-555555555555", "mic");
    s.confirmStart("audio/webm");
    s.beginStop();
    render(<DashboardHeader />);
    expect(screen.getByRole("status")).toHaveTextContent(/^saving$/i);
  });

  // #24: Saved is at rest — a new recording can start from it.
  it("offers Record again once the recording is saved", async () => {
    const s = useRecorderStore.getState();
    s.requestStart("11111111-2222-3333-4444-555555555555", "mic");
    s.confirmStart("audio/webm");
    s.beginStop();
    s.beginUpload();
    s.finish();
    const before = useRecorderStore.getState().startRequests;
    render(<DashboardHeader />);
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(useRecorderStore.getState().startRequests).toBe(before + 1);
  });
});

/** Issue #91: below 768px the header is the whole masthead. */
describe("DashboardHeader on a phone", () => {
  it("carries the menu it is given", () => {
    render(<DashboardHeader menu={<button type="button">Menu</button>} />);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("names the note count for a screen reader", () => {
    render(<DashboardHeader notesCount={3} />);
    expect(screen.getByLabelText("3 notes")).toHaveTextContent("3");
  });
});
