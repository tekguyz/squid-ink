import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
