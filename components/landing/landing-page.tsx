import Link from "next/link";
import { NoteSpecimen } from "./note-specimen";
import { PersonaTable } from "./persona-table";

/**
 * The landing page (issue #60): what a person with no session sees at "/".
 * app/page.tsx renders it when there is no user; a signed-in user never sees it.
 *
 * The sheet is the app's, not a marketing skin: newsprint paper, hairline
 * rules, square corners, mono slugs, Bitter for anything with a name. It reads
 * like a printed front page, and it shows the product rather than describing
 * it — the specimen is a real note from the demo fixture.
 *
 * A server component with no client island and no data read: with no session
 * there is no RLS identity to read as. The chips in the specimen are fragment
 * links, so even they need no JavaScript.
 *
 * Copy rules (PRODUCT.md): no signup offer, because there is none; no feature
 * that does not exist; no figure nobody measured.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const WRAP = "mx-auto w-full max-w-[1180px] px-4 sm:px-[26px]";

const SLUG = "font-mono text-muted text-[9px] tracking-[0.16em] uppercase";

const OUTLINE_BUTTON = `border-control-edge bg-raised text-ink hover:bg-pane font-mono inline-flex min-h-[36px] items-center border px-[15px] text-[10.5px] font-medium tracking-[0.08em] uppercase ${FOCUS}`;

const TEXT_LINK = `text-ink underline decoration-control-edge underline-offset-[3px] hover:decoration-ink ${FOCUS}`;

const TEKGUYZ = "https://tekguyz.com";

/** Numbered because the order is the information: it happens in this order. */
const STEPS = [
  {
    n: "01",
    title: "Record",
    body: "In the browser, from the call’s audio, your mic, or both. Nothing joins the call and nothing asks for your calendar.",
  },
  {
    n: "02",
    title: "Transcribe",
    body: "The recording becomes timed segments, with speaker labels when the recording allows them.",
  },
  {
    n: "03",
    title: "Write up",
    body: "A summary, numbered takeaways and action items. Each claim carries a citation to the segment it came from.",
  },
] as const;

/** A labelled rule that opens a section. DESIGN.md: a hairline never carries a
 *  section break alone, so every one has its slug. */
function SectionHead({ slug, title, id }: { slug: string; title: string; id: string }) {
  return (
    <header className="border-ink border-t pt-[11px]">
      <p className={SLUG}>{slug}</p>
      <h2 id={id} className="font-header text-ink mt-[9px] text-[26px] leading-[1.15] font-medium tracking-[-0.012em] text-balance sm:text-[30px]">
        {title}
      </h2>
    </header>
  );
}

export function LandingPage() {
  return (
    <div className="bg-paper text-ink min-h-dvh">
      <header className={`${WRAP} flex items-center justify-between gap-4 py-[16px]`}>
        <p className="font-header text-ink flex items-center gap-[8px] text-[16px] font-bold tracking-[-0.01em]">
          <span aria-hidden="true" className="bg-accent h-[18px] w-[18px]" />
          <span translate="no">Squid Ink</span>
        </p>
        <Link href="/login" className={OUTLINE_BUTTON}>
          Sign in
        </Link>
      </header>

      <main>
        <div className={WRAP}>
          {/* The masthead's double rule: the one place the page uses two. */}
          <div aria-hidden className="border-t-ink border-b-rule h-[4px] border-t border-b" />
          <p className={`${SLUG} flex flex-wrap justify-between gap-x-6 gap-y-1 py-[7px]`}>
            <span>A meeting notepad</span>
            <span>No bot in the call</span>
          </p>
          <div aria-hidden className="bg-rule h-px" />
        </div>

        <section
          aria-labelledby="landing-title"
          className={`${WRAP} grid gap-x-[48px] gap-y-[34px] pt-[40px] pb-[56px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-[56px]`}
        >
          {/* Sticky on wide screens: the specimen runs far taller than the
              headline, and this keeps the claim beside its proof. */}
          <div className="lg:sticky lg:top-[32px] lg:self-start lg:pt-[6px]">
            <h1
              id="landing-title"
              className="font-header text-ink text-[40px] leading-[1.04] font-medium tracking-[-0.02em] text-balance sm:text-[52px] lg:text-[56px]"
            >
              Sit in the meeting. Leave with the notes.
            </h1>
            <p className="text-ink-2 mt-[20px] max-w-[46ch] text-[16px] leading-[1.62] text-pretty">
              Squid Ink records a meeting in your browser, with no bot joining the call. Then
              it writes the transcript, a summary, takeaways and action items — and every claim
              links back to the line it came from.
            </p>
            {/* The demo entry goes first in this row when it ships (#19). It
                is a button in a form, never a link: docs/adr/0001. Until then
                a stranger's one real next step is the studio that built it;
                Sign in stays in the masthead, for the few it is for. */}
            <div className="mt-[26px] flex flex-wrap items-center gap-x-[16px] gap-y-[10px]">
              <a href={TEKGUYZ} className={OUTLINE_BUTTON}>
                Talk to&nbsp;<span translate="no">TEKGUYZ</span>
              </a>
              <p className="text-muted text-[12.5px] leading-[1.5]">
                Accounts are by invitation. There is no public sign-up.
              </p>
            </div>
          </div>

          <NoteSpecimen />
        </section>

        <section aria-labelledby="how" className={`${WRAP} pb-[56px]`}>
          <SectionHead slug="How a note is made" title="You press record. It does the rest." id="how" />
          <ol className="mt-[22px] grid gap-x-[34px] gap-y-[22px] md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="border-rule md:border-l md:pl-[18px] md:first:border-l-0 md:first:pl-0">
                <p className="flex items-baseline gap-[10px]">
                  <span className="font-mono text-muted text-[11px] tabular-nums">{step.n}</span>
                  <span className="font-header text-ink text-[18px] font-semibold">{step.title}</span>
                </p>
                <p className="text-ink-2 mt-[7px] text-[14px] leading-[1.62] text-pretty">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <div
          className={`${WRAP} grid gap-x-[48px] gap-y-[48px] pb-[64px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`}
        >
          <section aria-labelledby="personas">
            <SectionHead slug="Personas" title="Choose who writes the note." id="personas" />
            <p className="text-ink-2 mt-[14px] max-w-[62ch] text-[14.5px] leading-[1.66] text-pretty">
              A persona decides how a note is written. Its lens is whose expertise frames the
              analysis. Its depth — Brief, Dense or Exhaustive — is how much work goes into
              it. Each one also drafts the follow-up, like a client email or a handoff brief.
            </p>
            <div className="mt-[22px]">
              <PersonaTable />
            </div>
          </section>

          <section aria-labelledby="ask">
            <SectionHead slug="Ask your notes" title="Ask one note, or all of them." id="ask" />
            <p className="text-ink-2 mt-[14px] text-[14.5px] leading-[1.66] text-pretty">
              Chat reads a note with its whole transcript, or searches across every note you
              have. Answers carry the same citations as the note, so each one can be checked
              against what was actually said.
            </p>
          </section>
        </div>
      </main>

      <footer className="bg-canvas border-rule border-t">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-[22px]`}>
          <p className="text-ink-2 text-[13px] leading-[1.5]">
            <span translate="no">Squid Ink</span> is designed and built by{" "}
            <span translate="no">TEKGUYZ</span>, South Florida.
          </p>
          <a href={TEKGUYZ} className={`inline-flex min-h-[24px] items-center text-[13px] ${TEXT_LINK}`}>
            tekguyz.com
          </a>
        </div>
      </footer>
    </div>
  );
}
