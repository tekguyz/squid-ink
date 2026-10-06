import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhoneMenu } from "../phone-menu";

describe("PhoneMenu", () => {
  it("opens a native popover that holds what it is given", () => {
    render(
      <PhoneMenu id="test-menu">
        <a href="/personas">Personas</a>
      </PhoneMenu>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("popovertarget", "test-menu");

    const sheet = document.getElementById("test-menu");
    expect(sheet).toHaveAttribute("popover");
    // Closed, the popover is hidden from the accessibility tree — as it
    // should be — so the query has to ask for hidden elements.
    expect(sheet).toContainElement(
      screen.getByRole("link", { name: "Personas", hidden: true }),
    );
  });

  it("never sets a display class on the popover itself", () => {
    // A `flex` or `grid` there beats the browser's `display: none` on a
    // closed popover, and the menu would sit open over the page.
    render(<PhoneMenu id="test-menu">x</PhoneMenu>);
    const sheet = document.getElementById("test-menu")!;
    expect(sheet.className).not.toMatch(/(^|\s)(flex|grid|block|inline-flex)(\s|$)/);
  });

  // Review of #91: a tag, Clear or All notes goes to "/" again, the page does
  // not remount, and a press INSIDE a popover is not a light-dismiss — so the
  // sheet stayed open over the feed it had just filtered.
  it("closes when a link inside it is chosen", () => {
    render(
      <PhoneMenu id="test-menu">
        <a href="/?tag=x">x</a>
        <span>not a link</span>
      </PhoneMenu>,
    );
    const sheet = document.getElementById("test-menu")!;
    const hide = vi.fn();
    Object.assign(sheet, { hidePopover: hide });
    fireEvent.click(screen.getByText("not a link"));
    expect(hide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("x"));
    expect(hide).toHaveBeenCalledOnce();
  });
});
