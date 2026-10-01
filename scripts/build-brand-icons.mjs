/**
 * Writes every brand icon from the tokens in app/globals.css (issue #80).
 *
 *   node scripts/build-brand-icons.mjs
 *
 * Re-run it when a colour the mark uses changes; `brand-icons.test.ts` fails
 * until you do. `sharp` ships with Next.js and is not a direct dependency, so
 * this stays a script and never imports from app code.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildIconSvg, icoFromPngs, readTokens, standaloneSvg } from "./brand-icons.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (path) => {
  const full = resolve(root, path);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};

const tokens = readTokens(readFileSync(resolve(root, "app/globals.css"), "utf8"));
const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 64 }).resize(size, size).png().toBuffer();

// Tab strip and bookmarks: one SVG that follows the browser's light or dark.
writeFileSync(out("app/icon.svg"), buildIconSvg(tokens));

// Old browsers and anything that asks for /favicon.ico. ICO has no dark mode,
// and the hairline frame keeps the paper tile visible on a dark tab strip.
const framed = standaloneSvg(tokens.light);
writeFileSync(
  out("app/favicon.ico"),
  icoFromPngs(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(framed, size) })))),
);

// Home screens crop the tile themselves, so no frame.
const bare = standaloneSvg(tokens.light, { frame: false });
writeFileSync(out("app/apple-icon.png"), await png(bare, 180));

// PWA icons, ready for #34. The mark sits well inside the 80 % safe circle, so
// the maskable one is the bare tile.
writeFileSync(out("public/icons/icon-192.png"), await png(framed, 192));
writeFileSync(out("public/icons/icon-512.png"), await png(framed, 512));
writeFileSync(out("public/icons/icon-maskable-512.png"), await png(bare, 512));

console.log("brand icons written");
