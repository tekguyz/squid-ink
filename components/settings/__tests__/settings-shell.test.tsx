import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell } from "../settings-shell";
import { applyTheme } from "@/components/theme-toggle";
import type { SettingsScreen } from "@/lib/settings/settings-types";

/** The Server Actions, stubbed. What the action does with a payload is
 *  app/notes/actions/__tests__/settings.test.ts's job; this file is about what
 *  the screen sends and when. */
const actions = vi.hoisted(() => ({
  saveCaptureSettings: vi.fn(async () => "written" as "written" | "not-found"),
}));
vi.mock("@/app/notes/actions/settings", () => actions);
vi.mock("@/app/notes/actions/session", () => ({ signOut: vi.fn() }));

const data: SettingsScreen = {
  email: "owner@example.test",
  settings: { requireCitations: true },
};

beforeEach(() => {
  actions.saveCaptureSettings.mockClear();
  actions.saveCaptureSettings.mockImplementation(async () => "written");
  document.documentElement.classList.remove("light", "dark");
  localStorage.clear();
});

const citationSwitch = () =>
  screen.getByRole("switch", { name: "Require a citation for every claim" });

describe("SettingsShell", () => {
  it("renders all seven nav destinations, with Personas linking to its own screen", () => {
    render(<SettingsShell screen={data} />);
    const nav = screen.getByRole("navigation", { name: "Settings" });
    for (const label of [
      "Account",
      "Capture & audio",
      "Personas",
      "Connected apps",
      "Appearance",
      "Sharing",
      "Data & privacy",
    ]) {
      expect(nav).toHaveTextContent(label);
    }
    // Twice since 2026-09-13: once in the shared app nav, once in this list.
    // Both go to the same screen.
    for (const link of screen.getAllByRole("link", { name: "Personas" })) {
      expect(link).toHaveAttribute("href", "/personas");
    }
    expect(screen.getByRole("link", { name: "Connected apps" })).toHaveAttribute(
      "href",
      "#connected-apps",
    );
  });

  it("shows the signed-in address and nothing implying a workspace", () => {
    render(<SettingsShell screen={data} />);
    expect(screen.getByText("owner@example.test")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/workspace|members|team/i);
  });

  it("draws none of the controls the design shows but this repo cannot back", () => {
    render(<SettingsShell screen={data} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/diarization/i);
    expect(text).not.toMatch(/meeting apps|detected locally/i);
    expect(text).not.toMatch(/match system|sunset/i);
    expect(text).not.toMatch(/keep local audio|30 days/i);
    // Data & privacy is an empty state, not a stubbed destructive action.
    expect(screen.queryByRole("button", { name: /delete|export/i })).toBeNull();
  });

  it("tracks the citation toggle as one unsaved change, named by section", async () => {
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();

    await user.click(citationSwitch());
    expect(citationSwitch()).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByText("1 unsaved change · Capture & audio")).toBeInTheDocument();

    // Toggling back is not a change.
    await user.click(citationSwitch());
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
  });

  it("saves the draft on Update, and the bar goes clean", async () => {
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    await user.click(citationSwitch());
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(actions.saveCaptureSettings).toHaveBeenCalledWith({ requireCitations: false });
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    expect(citationSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("Discard restores the saved value without calling the action", async () => {
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    await user.click(citationSwitch());
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(citationSwitch()).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    expect(actions.saveCaptureSettings).not.toHaveBeenCalled();
  });

  it("keeps the change and says so when the save is refused", async () => {
    actions.saveCaptureSettings.mockImplementation(async () => "not-found");
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    await user.click(citationSwitch());
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(citationSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("Connect says it is not built, instead of doing nothing or faking success", async () => {
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    await user.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    expect(
      screen.getByText("Not connected yet · Google connect is not built"),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/connected ·|revocable/i);
  });

  it("applies a theme instantly, and follows the <html> class it paints from", async () => {
    const user = userEvent.setup();
    render(<SettingsShell screen={data} />);

    const espresso = screen.getByRole("button", { name: /Espresso Dark/ });
    const newsprint = screen.getByRole("button", { name: /Newsprint Light/ });

    await user.click(espresso);
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    await waitFor(() => expect(espresso).toHaveAttribute("aria-pressed", "true"));
    // No Update needed for a theme.
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();

    // A theme change from anywhere else reaches the cards without a click.
    act(() => applyTheme("light"));
    await waitFor(() => expect(newsprint).toHaveAttribute("aria-pressed", "true"));
    expect(espresso).toHaveAttribute("aria-pressed", "false");
  });
});
