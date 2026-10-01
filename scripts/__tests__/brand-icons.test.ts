import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "../../proxy";
import {
  buildIconSvg,
  icoFromPngs,
  oklchToHex,
  readTokens,
} from "../brand-icons.mjs";

const read = (path: string) => readFileSync(join(process.cwd(), path));
const css = read("app/globals.css").toString("utf8");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("oklchToHex", () => {
  it("maps the two ends of the scale", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
  });
});

describe("readTokens", () => {
  it("reads the light and the dark value of every colour the mark uses", () => {
    const t = readTokens(css);
    for (const name of ["paper", "ink", "accent", "rule-strong"] as const) {
      expect(t.light[name]).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.dark[name]).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.dark[name]).not.toBe(t.light[name]);
    }
  });
});

describe("icoFromPngs", () => {
  it("writes an ICO directory with one entry per size", () => {
    const png = (n: number) => ({ size: n, data: Buffer.from(`png${n}`) });
    const ico = icoFromPngs([png(16), png(32), png(48)]);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(3); // image count
    expect([6, 22, 38].map((o) => ico.readUInt8(o))).toEqual([16, 32, 48]);
    // The first image starts right after the header and three entries.
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 3 * 16);
  });
});

describe("the committed brand assets", () => {
  it("app/icon.svg is built from the current tokens, light and dark", () => {
    expect(read("app/icon.svg").toString("utf8")).toBe(buildIconSvg(readTokens(css)));
  });

  it("app/icon.svg switches to the dark tokens for a dark browser", () => {
    const svg = read("app/icon.svg").toString("utf8");
    const t = readTokens(css);
    expect(svg).toContain("prefers-color-scheme: dark");
    expect(svg).toContain(t.light.accent);
    expect(svg).toContain(t.dark.accent);
  });

  it("app/favicon.ico holds 16, 32 and 48 px images", () => {
    const ico = read("app/favicon.ico");
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([6, 22, 38].map((o) => ico.readUInt8(o))).toEqual([16, 32, 48]);
  });

  it.each([
    ["app/apple-icon.png", 180],
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/icon-maskable-512.png", 512],
  ])("%s is %i px square", (path, size) => {
    expect(pngSize(read(path))).toEqual({ w: size, h: size });
  });
});

describe("proxy.ts", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    "/favicon.ico",
    "/icon.svg",
    "/apple-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-maskable-512.png",
  ])("skips %s, so a browser asking for an icon gets no session redirect", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it("still runs on a page", () => {
    expect(matcher.test("/notes/abc")).toBe(true);
  });
});
