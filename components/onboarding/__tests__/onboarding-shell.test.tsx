import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingShell } from "../onboarding-shell";
import type { PersonaConfig } from "@/lib/notes/get-personas-screen";

/** The Server Actions, stubbed. This file is about what the screen sends and
 *  when; what the actions do with it is theirs. */
const actions = vi.hoisted(() => ({
  setDefaultPersona: vi.fn(async (_slug: string) => "written" as string),
  completeOnboarding: vi.fn(async (_exit: string) => undefined as unknown),
}));
vi.mock("@/app/notes/actions/configure-persona", () => ({
  setDefaultPersona: actions.setDefaultPersona,
}));
vi.mock("@/app/notes/actions/onboarding", () => ({
  completeOnboarding: actions.completeOnboarding,
}));
vi.mock("@/app/notes/actions/session", () => ({ signOut: vi.fn() }));
// browser-deps pulls in the Supabase browser client and the recording action;
// the step only needs readLevel.
vi.mock("@/lib/recorder/browser-deps", () => ({ readLevel: () => 0.5 }));

const personas: PersonaConfig[] = [
  { id: "neutral-analyst", name: "Neutral Analyst", sub: "Balanced", depth: "standard", actions: [] },
  { id: "investor", name: "Investor", sub: "Money", depth: "standard", actions: [] },
] as unknown as PersonaConfig[];

beforeEach(() => {
  actions.setDefaultPersona.mockClear();
  actions.completeOnboarding.mockClear();
});

const renderShell = () =>
  render(<OnboardingShell personas={personas} defaultPersonaId="neutral-analyst" />);

async function toStep(user: ReturnType<typeof userEvent.setup>, n: 2 | 3) {
  await user.click(screen.getByRole("button", { name: "Continue" }));
  if (n === 3) {
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Connect calendar" });
  }
}

describe("OnboardingShell", () => {
  it("has three steps and no workspace step", () => {
    renderShell();
    const steps = screen.getByRole("list", { name: "Onboarding steps" });
    expect(steps.querySelectorAll("li")).toHaveLength(3);
    expect(document.body).not.toHaveTextContent(/workspace/i);
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("does not claim system audio is granted, and never blocks Continue on the mic", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByText("Asked each recording")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/granted/i);
    await toStep(user, 2);
    expect(screen.getByRole("heading", { name: "Pick a default persona" })).toBeInTheDocument();
  });

  it("saves the chosen lens through setDefaultPersona before moving on", async () => {
    const user = userEvent.setup();
    renderShell();
    await toStep(user, 2);
    await user.click(screen.getByRole("radio", { name: /Investor/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(actions.setDefaultPersona).toHaveBeenCalledWith("investor");
    await screen.findByRole("heading", { name: "Connect calendar" });
  });

  it("lets an account with no persona rows past step 2 on the fallback lens", async () => {
    actions.setDefaultPersona.mockImplementationOnce(async () => "no-persona");
    const user = userEvent.setup();
    renderShell();
    await toStep(user, 2);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Connect calendar" });
  });

  it("stays on step 2 and says so when a picked lens is refused", async () => {
    actions.setDefaultPersona.mockImplementationOnce(async () => "no-persona");
    const user = userEvent.setup();
    renderShell();
    await toStep(user, 2);
    await user.click(screen.getByRole("radio", { name: /Investor/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be set/);
    expect(screen.getByRole("heading", { name: "Pick a default persona" })).toBeInTheDocument();
  });

  it("offers no connect action of its own on the calendar step", async () => {
    const user = userEvent.setup();
    renderShell();
    await toStep(user, 3);
    expect(screen.queryByRole("button", { name: /^connect/i })).toBeNull();
  });

  it("finishes onboarding toward Connected apps, or toward the dashboard on skip", async () => {
    const user = userEvent.setup();
    renderShell();
    await toStep(user, 3);
    await user.click(screen.getByRole("button", { name: "Open Connected apps" }));
    await waitFor(() =>
      expect(actions.completeOnboarding).toHaveBeenCalledWith("connected-apps"),
    );
    await user.click(screen.getByRole("button", { name: /Skip/ }));
    await waitFor(() => expect(actions.completeOnboarding).toHaveBeenCalledWith("dashboard"));
  });
});
