// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ThemeBoot } from "../theme-boot";

describe("ThemeBoot on the server", () => {
  it("emits an executable script, so the theme applies before first paint", () => {
    const html = renderToString(<ThemeBoot />);
    expect(html).toContain('<script type="text/javascript">');
    expect(html).toContain('localStorage.getItem("theme")');
  });
});
