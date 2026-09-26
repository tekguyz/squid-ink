/**
 * The contrast half of verify-layout.mjs (issue #22). Its own file because the
 * layout script is already long, and because this probe is written as a real
 * function and shipped to the page as its source text — `probe.toString()` —
 * so it reads as code instead of an escaped string.
 *
 * It measures the three tokens #22 added, in the BUILT CSS, against the
 * background each element actually sits on — never against `paper` alone:
 *
 *   --ink-disabled  the colour of every visible, unselected, non-busy disabled or
 *                   aria-disabled control, 3.0-3.7:1 on its sheet (a design band;
 *                   WCAG exempts inactive controls).
 *   --live-tint     a fill: the label on it >= 4.5:1 (WCAG 1.4.3, 9px text),
 *                   its frame >= 3:1 against the fill AND the sheet outside.
 *   --rule-strong   a structural seam, 1.8-2.6:1 against the sheets on both
 *                   sides: clear of --rule (~1.46) and below --control-edge.
 *
 * Colours are resolved by drawing them on a 1px canvas, so the numbers are
 * the sRGB pixels the browser really paints, whatever syntax it computed.
 */

function probe() {
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 })
    .getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (x, y) => {
    const [a, b] = [lum(x), lum(y)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const same = (x, y) => x.every((v, i) => Math.abs(v - y[i]) < 0.01);

  // The token as the page resolves it right now, in the active theme.
  const token = (name) => {
    const el = document.createElement("i");
    el.style.color = `var(--${name})`;
    document.body.append(el);
    const value = rgba(getComputedStyle(el).color);
    el.remove();
    return value;
  };

  // The opaque colour behind an element: its own fill, composited over each
  // ancestor's until the stack is opaque. Every sheet in this app is opaque,
  // so this normally stops at the first fill it meets.
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) {
      out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    }
    return out;
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) =>
    el.tagName.toLowerCase() +
    (el.getAttribute("aria-label") ? ` [${el.getAttribute("aria-label")}]` : "") +
    ((el.textContent || "").trim() ? ` "${el.textContent.trim().slice(0, 30)}"` : "");
  const all = [...document.querySelectorAll("body *")]
    .filter((el) => !el.closest("nextjs-portal") && visible(el));
  const cls = (el) => (typeof el.className === "string" ? el.className : "");
  const round = (n) => Math.round(n * 100) / 100;

  const inkDisabled = token("ink-disabled");
  const liveTint = token("live-tint");
  const ruleStrong = token("rule-strong");

  // Every visible disabled control, whatever its classes say. Its own colour
  // must BE the token — that is the idiom checked in a browser, not in text.
  // A disabled control that is SELECTED keeps its selected look: it reports
  // an answer (the lens a note was written in, the default lens), and dimming
  // it would hide the answer along with the control.
  const disabled = all
    .filter((el) => el.matches(':is(:disabled, [aria-disabled="true"])'))
    .filter((el) => !el.matches('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]'))
    // A BUSY button is not unavailable: it keeps its fill and says so.
    .filter((el) => !el.matches('[aria-busy="true"]'))
    .map((el) => {
      const color = rgba(getComputedStyle(el).color);
      return { el: label(el), isToken: same(color, inkDisabled), ratio: round(ratio(color, backdrop(el))) };
    });

  const tints = all
    .filter((el) => same(rgba(getComputedStyle(el).backgroundColor), liveTint))
    .map((el) => {
      const s = getComputedStyle(el);
      const outside = el.parentElement ? backdrop(el.parentElement) : [255, 255, 255];
      const frame = rgba(s.borderTopColor);
      return {
        el: label(el),
        text: round(ratio(rgba(s.color), liveTint)),
        frameOnFill: round(ratio(frame, liveTint)),
        frameOnSheet: round(ratio(frame, outside)),
      };
    });
  const tintShown = all.filter((el) => /\bbg-live-tint\b/.test(cls(el))).length;

  const seams = all.flatMap((el) => {
    const s = getComputedStyle(el);
    const sides = ["Top", "Right", "Bottom", "Left"].filter(
      (side) => parseFloat(s[`border${side}Width`]) > 0 && same(rgba(s[`border${side}Color`]), ruleStrong),
    );
    if (!sides.length) return [];
    const inside = backdrop(el);
    const outside = el.parentElement ? backdrop(el.parentElement) : inside;
    return [{
      el: label(el) + " " + sides.join("/").toLowerCase(),
      inside: round(ratio(ruleStrong, inside)),
      outside: round(ratio(ruleStrong, outside)),
    }];
  });
  const seamShown = all.filter((el) => /\brule-strong\b/.test(cls(el))).length;

  // Issue #65. The metadata ladder colours 8.5-10px mono labels, so every
  // one is small text and owes WCAG 1.4.3's 4.5:1 on the sheet it is on.
  // Only elements that paint their OWN text are measured.
  const ladder = ["muted", "meta", "meta-2", "meta-3", "meta-4", "meta-5"].map((name) => [name, token(name)]);
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const labels = all.filter(ownText).flatMap((el) => {
    const color = rgba(getComputedStyle(el).color);
    const hit = ladder.find(([, value]) => same(color, value));
    return hit ? [{ el: label(el), token: hit[0], ratio: round(ratio(color, backdrop(el))) }] : [];
  });

  return { disabled, tints, tintShown, seams, seamShown, labels };
}

export const CONTRAST_PROBE = `(${probe.toString()})()`;

/** The fixture owner has no 'failed' note, so the Dashboard shows no Failed
 *  pill to measure. This puts one — the same classes status-pill.tsx ships —
 *  into the first real note row, so the BUILT CSS is measured on the row's
 *  real sheet. `data-contrast-probe` marks it; UNPLANT removes it. */
export const PLANT_FAILED_PILL = `(() => {
  // The first VISIBLE row: below lg a hidden copy can come first in the DOM.
  const row = [...document.querySelectorAll('a[href^="/notes/"]')].find(
    (a) => a.getClientRects().length > 0 && getComputedStyle(a).visibility !== "hidden",
  );
  if (!row) return false;
  const pill = document.createElement("span");
  pill.dataset.contrastProbe = "";
  // Mirrors status-pill.tsx PILL + LOOKS.failed. A .mjs script cannot import
  // the .tsx, so a change to that pill must be copied here.
  pill.className = "inline-flex items-center gap-[5px] border px-[7px] py-[2px] font-mono text-[9px] tracking-[0.14em] uppercase border-live bg-live-tint text-live font-medium";
  const marker = document.createElement("span");
  marker.className = "h-[9px] w-[9px] bg-live";
  pill.append(marker, "Failed");
  row.append(pill);
  return true;
})()`;

export const UNPLANT = `document.querySelectorAll("[data-contrast-probe]").forEach((el) => el.remove())`;

const INK_DISABLED = [3.0, 3.7];
const RULE_STRONG = [1.8, 2.6];

/** `expect` names the tokens this route is known to render, so a route that
 *  should show one and measured none fails instead of passing on nothing. */
export function reportContrast(check, where, probe, expect = []) {
  const { disabled, tints, tintShown, seams, seamShown, labels } = probe;
  const inBand = (n, [lo, hi]) => n >= lo && n <= hi;

  // The measured range, printed, so the numbers docs record come from here.
  const range = (ns) => (ns.length ? `${Math.min(...ns)}-${Math.max(...ns)}` : "none");
  console.log(
    `  note: ${where} — ink-disabled ${range(disabled.map((d) => d.ratio))}, ` +
      `live-tint text ${range(tints.map((t) => t.text))} frame ${range(tints.flatMap((t) => [t.frameOnFill, t.frameOnSheet]))}, ` +
      `rule-strong ${range(seams.flatMap((s) => [s.inside, s.outside]))}, ` +
      `meta ladder ${range(labels.map((l) => l.ratio))}`,
  );

  const faint = labels.filter((l) => l.ratio < 4.5);
  check(
    faint.length === 0,
    `${where} — every metadata-ladder label clears 4.5:1 (${labels.length} measured)`,
    [...new Map(faint.map((l) => [`${l.token} ${l.ratio}`, l])).values()]
      .map((l) => `${l.token} at ${l.ratio}:1, e.g. ${l.el}`)
      .join("; "),
  );

  const offToken = disabled.filter((d) => !d.isToken);
  const offBand = disabled.filter((d) => d.isToken && !inBand(d.ratio, INK_DISABLED));
  check(
    offToken.length === 0 && offBand.length === 0 && (disabled.length > 0 || !expect.includes("ink-disabled")),
    `${where} — every disabled control is ink-disabled at ${INK_DISABLED.join("-")}:1 (${disabled.length} measured)`,
    disabled.length === 0
      ? "no disabled control measured on a route that shows one"
      : [
          ...offToken.map((d) => `${d.el} is not ink-disabled`),
          ...offBand.map((d) => `${d.el} at ${d.ratio}:1`),
        ].join("; "),
  );

  const weak = tints.filter((t) => t.text < 4.5 || t.frameOnFill < 3 || t.frameOnSheet < 3);
  check(
    weak.length === 0 && tints.length >= (tintShown > 0 ? 1 : 0) && (tints.length > 0 || !expect.includes("live-tint")),
    `${where} — every live-tint fill clears 4.5:1 text and 3:1 frame (${tints.length} measured)`,
    tints.length === 0
      ? tintShown > 0
        ? "a live-tint class is on the page but no element measured with the token"
        : "no live-tint fill measured on a route that shows one"
      : weak.map((t) => `${t.el} text ${t.text}, frame ${t.frameOnFill}/${t.frameOnSheet}`).join("; "),
  );

  const off = seams.filter((s) => !inBand(s.inside, RULE_STRONG) || !inBand(s.outside, RULE_STRONG));
  check(
    off.length === 0 && seams.length >= (seamShown > 0 ? 1 : 0) && (seams.length > 0 || !expect.includes("rule-strong")),
    `${where} — every rule-strong seam is ${RULE_STRONG.join("-")}:1 on both sides (${seams.length} measured)`,
    seams.length === 0
      ? "no rule-strong seam measured on a route that shows one"
      : off.map((s) => `${s.el} ${s.inside}/${s.outside}`).join("; "),
  );
}
