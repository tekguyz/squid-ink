import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell } from "../settings-shell";
import { applyTheme } from "@/components/theme-toggle";
import type { SettingsScreen } from "@/lib/settings/settings-types";

vi.mock("@/app/notes/actions/session", () => ({ signOut: vi.fn() }));

const data: SettingsScreen = { email: "owner@example.test" };

beforeEach(() => {
  document.documentElement.classList.remove("light", "dark");
  localStorage.clear();
});

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

  it("offers no citation switch: grounding is always on, so there is nothing to choose", () => {
    render(<SettingsShell screen={data} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(document.body).not.toHaveTextContent(/require a citation/i);
    const capture = screen.getByRole("region", { name: "Capture & audio" });
    expect(capture).toHaveTextContent("Nothing built here yet");
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
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
