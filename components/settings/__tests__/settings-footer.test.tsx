import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirtyRegistryProvider, useDirtySection } from "../dirty-registry";
import { SettingsFooter } from "../settings-footer";

/**
 * The Update / Discard bar, driven by a stand-in section.
 *
 * No real section persists a preference today (the citation switch was removed
 * on 2026-09-26, issue #3), but the bar and the registry are what the next one
 * lands on, so their contract is proven here rather than through a real field.
 */
function FakeSection({ save }: { save: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [on, setOn] = useState(saved);
  useDirtySection(
    "fake",
    "Fake section",
    on === saved ? 0 : 1,
    async () => {
      await save();
      setSaved(on);
    },
    () => setOn(saved),
  );
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => setOn((v) => !v)}>
      Fake
    </button>
  );
}

function renderBar(save: () => Promise<void> = async () => {}) {
  render(
    <DirtyRegistryProvider>
      <FakeSection save={save} />
      <SettingsFooter />
    </DirtyRegistryProvider>,
  );
  return { toggle: () => screen.getByRole("switch", { name: "Fake" }) };
}

describe("SettingsFooter", () => {
  it("counts one unsaved change and names its section; toggling back is not a change", async () => {
    const user = userEvent.setup();
    const { toggle } = renderBar();

    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();

    await user.click(toggle());
    expect(await screen.findByText("1 unsaved change · Fake section")).toBeInTheDocument();

    await user.click(toggle());
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
  });

  it("saves on Update, and the bar goes clean", async () => {
    const save = vi.fn(async () => {});
    const user = userEvent.setup();
    const { toggle } = renderBar(save);

    await user.click(toggle());
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(save).toHaveBeenCalledOnce();
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("Discard restores the saved value without saving", async () => {
    const save = vi.fn(async () => {});
    const user = userEvent.setup();
    const { toggle } = renderBar(save);

    await user.click(toggle());
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the change and says so when the save is refused", async () => {
    const user = userEvent.setup();
    const { toggle } = renderBar(async () => {
      throw new Error("refused");
    });

    await user.click(toggle());
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });
});
