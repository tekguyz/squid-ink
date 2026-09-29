// Takes the showcase screenshots from the live demo (DEMO-STANDARD.md >
// Showcase screenshots). Run it again after a screen in the set changes a lot.
//
//   npm run showcase
//   npm run showcase -- http://localhost:3000
//
// It opens the landing page and presses "Try the demo", in one fresh browser,
// so the data is the demo owner's sample notes. Each screen at desktop
// 1440x900 and phone 390x844, in light and dark, English, demo banner and dev
// badge hidden. The PNGs go to `showcase/`, named for the screen, the width
// and the theme. They change only when someone runs this.
//
// It drives the Edge or Chrome already on the laptop (playwright-core), so no
// browser is downloaded. Each run starts one anonymous demo visitor; the
// 7-day cleanup deletes it.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

function fail(message) {
  console.error(`showcase: ${message}`);
  process.exit(1);
}

const site = (process.argv[2] ?? "https://squid-ink.vercel.app").replace(/\/$/, "");

const OUT = "showcase";
const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const LOOK = { locale: "en-US", reducedMotion: "reduce" };

// The theme follows the browser's colour scheme when nothing is saved
// (components/theme-boot.tsx), and each context starts with nothing saved.
const THEMES = ["light", "dark"];

const NOTE = /^\/notes\/[^/]+$/;

/**
 * The set. `open` is a path, or a start path and the link pattern to follow
 * from it: the first link whose address matches. The demo owner's notes are
 * fixed (scripts/load-demo-owner.mjs), so "the first one" is the same every run.
 */
const SHOTS = [
  { name: "dashboard", open: "/" },
  { name: "note", open: ["/", NOTE] },
  { name: "personas", open: "/personas" },
];

// The demo banner is `aside[data-demo-banner]`. Hiding it leaves its height
// token set, so it is zeroed too. `nextjs-portal` is the Next.js dev badge.
const HIDE = `
  [data-demo-banner], nextjs-portal { display: none !important; }
  body { --demo-banner-h: 0px !important; }
`;

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // Not on this laptop: try the next one.
    }
  }
  fail("needs Microsoft Edge or Google Chrome installed.");
}

/** Presses "Try the demo"; returns the visitor's signed-in cookies. */
async function startDemo(browser) {
  const context = await browser.newContext({ ...SIZES.desktop, ...LOOK });
  const page = await context.newPage();
  await page.goto(site);
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  // The demo lands back on "/", now the Dashboard; the banner proves it.
  await page.locator("[data-demo-banner]").waitFor({ timeout: 60_000 }).catch(() => {
    fail("no demo banner after pressing Try the demo. Is the demo busy or off?");
  });
  const session = await context.storageState();
  await context.close();
  return session;
}

/** The address of the first link on the page that matches. */
async function firstLink(page, pattern) {
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  const href = hrefs.find((h) => h && pattern.test(h));
  if (!href) fail(`no link matching ${pattern} on ${page.url()}. Did the demo notes change?`);
  return href;
}

async function shoot(browser, session, shot, size, theme) {
  const context = await browser.newContext({ ...SIZES[size], ...LOOK, colorScheme: theme, storageState: session });
  const page = await context.newPage();
  if (typeof shot.open === "string") {
    await page.goto(site + shot.open);
  } else {
    const [start, link] = shot.open;
    await page.goto(site + start);
    await page.goto(new URL(await firstLink(page, link), site).href);
  }
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(() => document.fonts.ready);
  const path = `${OUT}/${shot.name}-${size}-${theme}.png`;
  await page.screenshot({ path });
  await context.close();
  console.log(`showcase: ${path}`);
}

mkdirSync(OUT, { recursive: true });
const browser = await launch();
try {
  const session = await startDemo(browser);
  for (const shot of SHOTS)
    for (const size of Object.keys(SIZES))
      for (const theme of THEMES) await shoot(browser, session, shot, size, theme);
} finally {
  await browser.close();
}
