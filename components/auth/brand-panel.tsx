import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import note from "@/showcase/note-desktop-light.png";

/**
 * The brand half of the desktop sign-in page (DEMO-STANDARD.md item 9, issue
 * #89). AuthSheet shows it from lg up; below that the page is the form only.
 *
 * Kept light on purpose: the name and one line, three short lines, one real
 * picture, and the way back to the landing page. No prices, no tour. The demo
 * door stays on the landing page, so the last item is a plain link, never a
 * demo button.
 *
 * Every line below is copied word for word from components/landing/
 * landing-page.tsx (the hero heading and the Record / Write up steps). Write
 * no new copy here; a test fails if a line drifts from the landing page.
 *
 * The picture is a real capture from showcase/ (retaken by scripts/
 * showcase.mjs), never a drawn mockup. It is decorative next to the lines, so
 * its alt text stays empty.
 */

export const PANEL_HEADLINE = "Sit in the meeting. Leave with the notes.";

export const PANEL_LINES = [
  "Nothing joins the call and nothing asks for your calendar.",
  "A summary, numbered takeaways and action items.",
  "Each takeaway and action item cites the segment it came from.",
] as const;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

export function BrandPanel() {
  return (
    <aside
      aria-label="About Squid Ink"
      className="bg-paper border-rule hidden min-h-dvh flex-col border-l px-[48px] py-[40px] lg:flex"
    >
      <p className="font-header text-ink flex items-center gap-[8px] text-[15px] font-bold tracking-[-0.01em]">
        <BrandMark />
        <span translate="no">Squid Ink</span>
      </p>
      <p className="font-header text-ink mt-[26px] max-w-[18ch] text-[34px] leading-[1.1] font-medium tracking-[-0.02em] text-balance">
        {PANEL_HEADLINE}
      </p>
      <ul className="text-ink-2 mt-[22px] flex max-w-[46ch] flex-col gap-[8px] text-[14px] leading-[1.55]">
        {PANEL_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {/* The picture takes the height that is left and is cropped from its top
          left corner, so a short laptop screen never pushes the link off. */}
      <div className="border-rule relative mt-[28px] min-h-[160px] flex-1 overflow-hidden border">
        <Image
          src={note}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 0px"
          className="object-cover object-left-top"
        />
      </div>
      <Link
        href="/"
        className={`text-ink mt-[22px] self-start text-[13.5px] underline decoration-control-edge underline-offset-[3px] hover:decoration-ink ${FOCUS}`}
      >
        Just looking? See what it does →
      </Link>
    </aside>
  );
}
