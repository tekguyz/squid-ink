/**
 * Writes app/opengraph-image.png: the card a chat app shows when someone pastes
 * the address (issue #60).
 *
 * The card IS the landing page's first screen, captured at 1200x630 in the
 * light theme, not a drawing of it. So it shows what a visitor then sees, and
 * it needs no colour of its own — app/globals.css stays the only file that
 * names one. Re-run it when the landing page's first screen changes.
 *
 *     npm run dev                          # in one shell, then:
 *     node scripts/capture-og-image.mjs    # in another
 *
 * No new dependency, the same way verify-layout.mjs does it: the Chrome that
 * is already installed, over the DevTools Protocol, with Node's own WebSocket.
 * Signed out by construction: a fresh profile has no cookies.
 *
 * Environment: CHROME_PATH, LAYOUT_ORIGIN (default http://localhost:3000).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ORIGIN = process.env.LAYOUT_ORIGIN ?? "http://localhost:3000";
const OUT = "app/opengraph-image.png";
const SIZE = { width: 1200, height: 630 };

const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!chrome) throw new Error("No Chrome found. Set CHROME_PATH.");

const port = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(path.join(tmpdir(), "og-image-"));
const proc = spawn(
  chrome,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" },
);

async function pageSocketUrl() {
  for (let i = 0; i < 150; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not listening yet; this loop is the wait.
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Chrome never opened its debug port");
}

try {
  const socket = new WebSocket(await pageSocketUrl());
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  await send("Emulation.setDeviceMetricsOverride", { ...SIZE, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Page.navigate", { url: `${ORIGIN}/` });
  await evaluate(`new Promise((r) => { const go = () => document.fonts.ready.then(() => setTimeout(r, 500)); document.readyState === "complete" ? go() : addEventListener("load", go); })`);

  const landed = await evaluate(`location.pathname`);
  if (landed !== "/") throw new Error(`Expected the landing page at /, landed on ${landed}`);
  // Next's dev-tools badge is a real element in development and does not ship.
  await evaluate(`document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()); window.scrollTo(0, 0)`);

  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, ...SIZE, scale: 1 },
  });
  writeFileSync(OUT, Buffer.from(data, "base64"));
  console.log(`wrote ${OUT} (${SIZE.width}x${SIZE.height}) from ${ORIGIN}/`);
  socket.close();
} finally {
  proc.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Windows sometimes still holds the profile directory. Harmless.
  }
}
