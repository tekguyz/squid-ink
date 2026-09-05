/**
 * Screen-level layout proof. Runs the real app in a real browser and measures
 * boxes.
 *
 * WHY THIS EXISTS, and why the 654 unit tests did not catch what it catches.
 *
 * Every other check in this repo is file-shaped. `npm test` renders components
 * in jsdom, which has no layout engine — every getBoundingClientRect() there is
 * zeros. `project-conventions.test.ts` reads source text. The impeccable
 * detector lints class strings. All three are correct and all three are blind
 * to the same class of defect: two files that are each right on their own and
 * wrong on the same pixels.
 *
 * That class is not hypothetical here. `components/theme-toggle.tsx` and the
 * Record HUD both claimed fixed bottom-right for a week, each faithful to its
 * own instruction, and nothing failed. Moving the toggle to bottom-left then
 * landed it on the persona rail's footer — the identical defect, in the other
 * corner, introduced by the fix for the first one. Neither was visible in a
 * screenshot at a glance; both were obvious the moment a rect was read out of
 * a live page. This script reads the rects.
 *
 * NO NEW DEPENDENCY. It drives the Chrome already on the machine over the
 * DevTools Protocol using Node's built-in WebSocket (global since Node 22, and
 * this repo is built on 24.18.0). Adding puppeteer for four assertions would
 * put a browser download in the install path of a project whose CLAUDE.md pins
 * every version by hand.
 *
 * Run with the dev server already up, the same shape as
 * verify-transcription-pipeline.mjs:
 *
 *     npm run dev                        # in one shell, then:
 *     node scripts/verify-layout.mjs     # in another
 *
 * Environment:
 *   CHROME_PATH   override the browser binary if it is not in a default place
 *   LAYOUT_ORIGIN override http://localhost:3000
 *   LAYOUT_KEEP=1 leave the browser open on failure, to look at it yourself
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.LAYOUT_ORIGIN ?? "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

/** The only widths this app supports today. CLAUDE.md and the scope of the
 *  2026-09-05 layout pass both say there is no responsive breakpoint work yet,
 *  so a mobile width here would report failures nobody has agreed to own.
 *  Add widths when breakpoints ship, not before. */
const WIDTHS = [1440, 1280];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const failures = [];
const passes = [];

function check(ok, label, detail) {
  if (ok) {
    passes.push(label);
    console.log(`  ok    ${label}`);
  } else {
    failures.push({ label, detail });
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Chrome over CDP. Small on purpose: connect, navigate, evaluate, close.
// ---------------------------------------------------------------------------

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome or Edge binary found. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
    );
  }
  return found;
}

async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      // Not listening yet. The loop below is the wait.
    }
    if (Date.now() > deadline) throw new Error("Chrome never opened its debug port");
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** A minimal CDP client. One socket, one id counter, one map of pending
 *  replies. Flat sessions so page commands ride the browser socket rather than
 *  needing a second connection per target. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((f) => f !== fn);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const fn = (msg) => {
        if (msg.method !== method) return;
        if (sessionId && msg.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((f) => f !== fn);
        resolve(msg.params);
      };
      this.listeners.push(fn);
    });
  }
}

async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? "page threw");
  }
  return result.value;
}

async function goto(cdp, sessionId, url) {
  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  // The App Router hydrates after load; the client shell mounts the theme
  // toggle and the recorder HUD, so measuring at loadEventFired would measure
  // a page missing exactly the elements this script is here to check.
  await evaluate(
    cdp,
    sessionId,
    `new Promise((r) => requestAnimationFrame(() => setTimeout(r, 350)))`,
  );
}

// ---------------------------------------------------------------------------
// The assertions. One string, evaluated in the page, returning plain data.
//
// It lives here rather than in a .js asset because it must stay a single
// self-contained expression the protocol can hand to Runtime.evaluate, and a
// second file would be a second thing to keep in step with this one.
// ---------------------------------------------------------------------------

const PROBE = `(() => {
  // Next's dev-tools badge is a real fixed element in the bottom-left corner
  // and it does not ship. Measuring it would fail the build on something no
  // user ever sees.
  const isDevChrome = (el) =>
    !!el.closest("nextjs-portal") || el.tagName.toLowerCase().startsWith("nextjs-");

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const all = [...document.querySelectorAll("*")].filter((el) => !isDevChrome(el));

  // --- fixed elements ------------------------------------------------------
  const fixed = all
    .filter((el) => getComputedStyle(el).position === "fixed" && visible(el))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }));

  const label = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
      : "";
    const aria = el.getAttribute("aria-label");
    return el.tagName.toLowerCase() + id + cls + (aria ? \` [\${aria}]\` : "");
  };

  const overlaps = (a, b) =>
    !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

  const fixedCollisions = [];
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      // A fixed element inside another fixed element is a layout choice, not a
      // collision — the HUD's pointer-events-none wrapper contains its own pill.
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (!overlaps(a.rect, b.rect)) continue;
      fixedCollisions.push({ a: label(a.el), b: label(b.el), aRect: a.rect.toJSON(), bRect: b.rect.toJSON() });
    }
  }

  // A fixed overlay landing on ordinary flow content is the persona-rail
  // failure. Text is what actually gets obscured, so leaf text nodes are what
  // is measured — a fixed chip sitting inside a big empty container is fine.
  const leafText = all.filter(
    (el) =>
      visible(el) &&
      getComputedStyle(el).position === "static" &&
      el.children.length === 0 &&
      (el.textContent || "").trim().length > 0,
  );

  const overlayHits = [];
  for (const f of fixed) {
    for (const t of leafText) {
      if (f.el.contains(t)) continue;
      const r = t.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (!overlaps(f.rect, r)) continue;
      overlayHits.push({
        overlay: label(f.el),
        text: (t.textContent || "").trim().slice(0, 40),
        overlayRect: f.rect.toJSON(),
        textRect: r.toJSON(),
      });
    }
  }

  const offscreen = fixed
    .filter((f) => f.rect.left < 0 || f.rect.top < 0 || f.rect.right > innerWidth + 1 || f.rect.bottom > innerHeight + 1)
    .map((f) => ({ el: label(f.el), rect: f.rect.toJSON() }));

  // --- scroll containers ---------------------------------------------------
  // Both engines are asserted, deliberately and separately. Firefox reads only
  // scrollbar-width / scrollbar-color; Chromium and WebKit read those AND the
  // pseudo-elements, and let the pseudo-elements win. A rule written for one
  // leaves the other on the OS default, which is the defect this replaced.
  const scrollers = all
    .filter((el) => {
      const s = getComputedStyle(el);
      const scrolls = /auto|scroll/.test(s.overflowY + s.overflowX);
      return scrolls && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    })
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        el: label(el),
        standardWidth: s.scrollbarWidth,
        standardColor: s.scrollbarColor,
        webkitWidth: getComputedStyle(el, "::-webkit-scrollbar").width,
        webkitButton: getComputedStyle(el, "::-webkit-scrollbar-button").display,
      };
    });

  return {
    fixedCount: fixed.length,
    fixedLabels: fixed.map((f) => label(f.el)),
    fixedCollisions,
    overlayHits,
    offscreen,
    scrollers,
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
  };
})()`;

// ---------------------------------------------------------------------------
// Sign-in. Reuses the generateLink path print-signin-link.mjs documents:
// login is magic-link only, and an emailed link is spent by a GET before a
// human clicks it, so the token has to be minted rather than mailed.
// ---------------------------------------------------------------------------

async function signInUrl() {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: env.RLS_TEST_OWNER_EMAIL,
  });
  if (error) throw error;
  return `${ORIGIN}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2F`;
}

// ---------------------------------------------------------------------------

function report(route, width, theme, probe) {
  const where = `${route} @ ${width}px ${theme}`;

  check(
    probe.fixedCollisions.length === 0,
    `${where} — no two fixed elements overlap`,
    probe.fixedCollisions
      .map((c) => `${c.a} x ${c.b}`)
      .join("; "),
  );

  check(
    probe.overlayHits.length === 0,
    `${where} — no fixed element covers flow text`,
    probe.overlayHits
      .map((h) => `${h.overlay} covers "${h.text}"`)
      .join("; "),
  );

  check(
    probe.offscreen.length === 0,
    `${where} — every fixed element is inside the viewport`,
    probe.offscreen.map((o) => `${o.el} at ${JSON.stringify(o.rect)}`).join("; "),
  );

  check(
    probe.horizontalOverflow <= 1,
    `${where} — no horizontal page overflow`,
    `document is ${probe.horizontalOverflow}px wider than the viewport`,
  );

  const bare = probe.scrollers.filter(
    (s) => s.standardWidth === "auto" || s.webkitWidth === "auto",
  );
  check(
    bare.length === 0,
    `${where} — every scroll container is themed in BOTH engines`,
    bare
      .map(
        (s) =>
          `${s.el} standard=${s.standardWidth} webkit=${s.webkitWidth}`,
      )
      .join("; "),
  );

  const arrows = probe.scrollers.filter((s) => s.webkitButton !== "none");
  check(
    arrows.length === 0,
    `${where} — no OS arrow buttons on any scrollbar`,
    arrows.map((s) => `${s.el} button=${s.webkitButton}`).join("; "),
  );
}

async function main() {
  // Fail early and clearly rather than reporting a page of empty measurements.
  try {
    const res = await fetch(ORIGIN, { redirect: "manual" });
    if (!res.status) throw new Error("no status");
  } catch {
    console.error(`\nCannot reach ${ORIGIN}. Start it first:\n\n    npm run dev\n`);
    process.exit(2);
  }

  const chrome = findChrome();
  const port = 9200 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(path.join(tmpdir(), "layout-probe-"));

  console.log(`browser : ${chrome}`);
  console.log(`origin  : ${ORIGIN}\n`);

  const proc = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      // The probe measures scrollbar geometry, so the browser must draw real
      // ones. Headless Chrome hides overlay scrollbars by default on some
      // platforms, which would make every scroll container look themed.
      "--disable-features=OverlayScrollbar",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    cdp = await Cdp.connect(await waitForDevTools(port));
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    await goto(cdp, sessionId, await signInUrl());

    // The dashboard names the routes worth measuring; hardcoding a note id
    // would rot the day the fixture is reseeded.
    const noteHref = await evaluate(
      cdp,
      sessionId,
      `(() => { const a = document.querySelector('a[href^="/notes/"]'); return a && a.getAttribute("href"); })()`,
    );
    if (!noteHref) throw new Error("Signed in, but the dashboard listed no note to measure");

    const routes = ["/", noteHref];

    for (const width of WIDTHS) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      for (const route of routes) {
        await goto(cdp, sessionId, `${ORIGIN}${route}`);
        for (const theme of ["light", "dark"]) {
          // Both themes on every route. CLAUDE.md's own rule: two tokens
          // looking distinct in light theme is not evidence they differ in
          // dark, and a contrast defect that exists in only one theme is
          // exactly the kind nobody looking at one screen ever sees.
          await evaluate(
            cdp,
            sessionId,
            `(() => { const r = document.documentElement; r.classList.remove("light","dark"); r.classList.add("${theme}"); })()`,
          );
          const probe = await evaluate(cdp, sessionId, PROBE);
          report(route, width, theme, probe);
        }
      }
    }
  } finally {
    if (!(failures.length && process.env.LAYOUT_KEEP === "1")) {
      try {
        cdp?.socket.close();
      } catch {
        // Already gone.
      }
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows sometimes still holds the profile directory. Harmless.
      }
    } else {
      console.log(`\nLAYOUT_KEEP=1 — browser left on :${port}, profile at ${profile}`);
    }
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  - ${f.label}\n    ${f.detail}`);
    process.exit(1);
  }
}

await main();
