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
});
