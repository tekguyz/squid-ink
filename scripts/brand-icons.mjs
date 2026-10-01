/**
 * The Squid Ink mark, as code (issue #80).
 *
 * The mark is Bitter 700's opening quote on a green tile:
 * the quote is the thing a note is made of, the bar is its source. Colours are
 * read from `app/globals.css` and turned into hex, because an icon file cannot
 * hold a `var()`. `scripts/__tests__/brand-icons.test.ts` fails when a
 * committed icon no longer matches the tokens.
 *
 * Pure functions only. `build-brand-icons.mjs` renders and writes the files.
 */

/** The quote glyph outlined from Bitter 700 (U+201C), already placed on the
 *  64 x 64 tile: 27 units tall, centred, top edge at y = 12. Outlined so the
 *  icon needs no font. Two sub-paths, one per comma. */
const QUOTE_PATH =
  "M29.18 32.56Q29.18 35.74 27.24 37.37Q25.29 39 22.91 39Q20.44 39 18.37 37.19Q16.29 35.38 16.29 31.76Q16.29 28.41 18.68 23.38Q21.06 18.35 26.88 12L31.03 14.74Q28.47 19.24 27.54 21.53Q26.62 23.82 26.62 24.97Q26.62 26.12 27.28 27.18Q27.94 28.24 28.56 29.47Q29.18 30.71 29.18 32.56ZM45.85 32.56Q45.85 35.74 43.91 37.37Q41.97 39 39.59 39Q37.12 39 35.09 37.19Q33.06 35.38 33.06 31.76Q33.06 28.41 35.4 23.38Q37.74 18.35 43.56 12L47.71 14.74Q45.15 19.24 44.22 21.53Q43.29 23.82 43.29 24.97Q43.29 26.12 43.96 27.18Q44.62 28.24 45.24 29.47Q45.85 30.71 45.85 32.56Z";

const TOKEN_NAMES = ["accent", "on-accent"];

/** `oklch(L C H)` to `#rrggbb`, clamped to sRGB. */
export function oklchToHex(value) {
  const [L, C, H] = value.match(/[\d.]+/g).map(Number);
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    linear
      .map((v) => {
        const c = Math.min(1, Math.max(0, v));
        const g = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.round(g * 255).toString(16).padStart(2, "0");
      })
      .join("")
  );
}

/** Hex values of the tokens the mark uses. In `app/globals.css` the first
 *  definition of each is the light one and the second is `.dark`. */
export function readTokens(css) {
  const tokens = { light: {}, dark: {} };
  for (const name of TOKEN_NAMES) {
    const found = [...css.matchAll(new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`, "g"))];
    if (found.length < 2) throw new Error(`--${name} is not defined for both themes`);
    tokens.light[name] = oklchToHex(found[0][1]);
    tokens.dark[name] = oklchToHex(found[1][1]);
  }
  return tokens;
}

/** The mark on a 64 x 64 square tile. `frame` adds a hairline in `rule-strong`
 *  so a paper tile is visible on a paper page; leave it off where the platform
 *  crops the tile itself (Apple's icon, a maskable icon). */
export function markSvg(colours, { frame = true } = {}) {
  return (
    `<rect width="64" height="64" fill="${colours.paper}"/>` +
    (frame
      ? `<rect x="0.75" y="0.75" width="62.5" height="62.5" fill="none" stroke="${colours["rule-strong"]}" stroke-width="1.5"/>`
      : "") +
    `<path d="${QUOTE_PATH}" fill="${colours.ink}"/>` +
    `<rect x="21" y="44" width="22" height="9" fill="${colours.accent}"/>`
  );
}

/** A full SVG for a given colour set. Used for the PNG renders. */
export function standaloneSvg(colours) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${markSvg(colours)}</svg>\n`;
}

/** `app/icon.svg`: one file that follows the browser's own light or dark
 *  setting, which is what a tab strip is drawn in. */
export function buildIconSvg(tokens) {
  const rule = (c) => `.t{fill:${c.accent}}.m{fill:${c["on-accent"]}}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<style>${rule(tokens.light)}@media (prefers-color-scheme: dark){${rule(tokens.dark)}}</style>` +
    `<rect class="t" width="64" height="64"/>` +
    `<rect class="f" x="0.75" y="0.75" width="62.5" height="62.5" fill="none" stroke-width="1.5"/>` +
    `<path class="i" d="${QUOTE_PATH}"/>` +
    `<rect class="a" x="21" y="44" width="22" height="9"/>` +
    `</svg>\n`
  );
}

/** An ICO file that wraps ready-made PNGs. Browsers read PNG inside ICO. */
export function icoFromPngs(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(size, at); // width
    header.writeUInt8(size, at + 1); // height
    header.writeUInt8(0, at + 2); // palette colours
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}
