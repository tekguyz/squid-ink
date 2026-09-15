import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewPasswordForm } from "@/app/login/new-password/new-password-form";

const calls = vi.hoisted(() => [] as unknown[]);

vi.mock("@/app/auth/actions/recovery", () => ({
  setNewPassword: async (input: unknown) => {
    calls.push(input);
    return { ok: false, failure: "weak_password" };
  },
}));

beforeEach(() => {
  calls.length = 0;
});

describe("new password — typed twice, with Show", () => {
  it("refuses a mismatch without calling the action", async () => {
    render(<NewPasswordForm />);
    await userEvent.type(screen.getByLabelText("Password"), "Right-Pass-1!");
    await userEvent.type(screen.getByLabelText("Type it again"), "Wrong-Pass-1!");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The two passwords do not match.");
    expect(calls).toEqual([]);
  });

  it("sends a matching password once", async () => {
    render(<NewPasswordForm />);
    await userEvent.type(screen.getByLabelText("Password"), "Same-Pass-1!");
    await userEvent.type(screen.getByLabelText("Type it again"), "Same-Pass-1!");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/);
    expect(calls).toEqual([{ password: "Same-Pass-1!" }]);
  });

  it("Show password reveals both fields as plain text", async () => {
    render(<NewPasswordForm />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByLabelText("Show password"));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Type it again")).toHaveAttribute("type", "text");
  });
});
