import { Fragment } from "react";
import { SpeakerAvatar } from "@/components/note-detail/speaker-avatar";
import { SPEAKER_TEXT } from "@/components/note-detail/speaker-colors";
import {
  SPECIMEN_ACTIONS,
  SPECIMEN_DURATION,
  SPECIMEN_SEGMENTS,
  SPECIMEN_SUMMARY,
  SPECIMEN_TAKEAWAYS,
  SPECIMEN_TITLE,
  segmentAnchor,
  segmentTime,
  type SpecimenClaim,
} from "./specimen";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** The app's citation chip, as a fragment link. The real one
 *  (note-detail/citation-chip.tsx) is a client button that scrolls a pane;
 *  this page ships no client code, and a link to `#t16` does the same job
 *  here. Same look, same label, same 24px target grown by `::before`. */
function Chip({ id, bare = false }: { id: number; bare?: boolean }) {
  const time = segmentTime(id);
  return (
    <a
      href={`#${segmentAnchor(id)}`}
      aria-label={`Jump to transcript at ${time}`}
      className={[
        "relative font-mono text-[10px] tabular-nums before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2",
        bare
          ? "text-accent-pressed hover:underline"
          : "bg-tint text-accent-text hover:bg-tint-hover mx-0.5 inline-block px-[5px] py-px align-[1px]",
        FOCUS,
      ].join(" ")}
    >
      {time}
    </a>
  );
}

/** Not a heading: the specimen is a figure inside the page, and its labels
 *  would otherwise read as sections of the landing page itself. */
function Label({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-2.5">
      <p className="font-mono text-muted text-[8.5px] tracking-[0.16em] uppercase">{children}</p>
      <span aria-hidden className="bg-rule-2 h-px flex-1" />
    </div>
  );
}

function Claims({ claims, numbered }: { claims: SpecimenClaim[]; numbered: boolean }) {
  return (
    <ol className="flex flex-col gap-[9px]">
      {claims.map((claim) => (
        <li key={claim.n} className="flex items-baseline gap-3">
          <span
            className={
              numbered
                ? "font-header text-accent w-5 flex-none text-[15px] font-semibold"
                : // A bullet, not a box: an empty square reads as a checkbox,
                  // and a control that looks live and does nothing is banned.
                  "bg-meta-3 mt-[8px] ml-[3px] size-[5px] flex-none"
            }
          >
            {numbered ? claim.n : null}
          </span>
          <span className="text-ink text-[13.5px] leading-[1.55] text-pretty">
            {claim.text}
            {claim.cites.map((id) => (
              <Fragment key={id}>
                {" "}
                <Chip id={id} bare={!numbered} />
              </Fragment>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A slice of a real note, drawn the way Note Detail draws it: the note on
 * paper, its transcript on the pane beside it. The content is the demo
 * fixture's (./specimen.ts). Every chip jumps to its line, which lights up
 * through `:target` with the app's active-segment wash.
 */
export function NoteSpecimen() {
  return (
    <figure className="bg-paper border-rule border">
      {/* The caption leads, so the instruction comes before the thing it is
          about at every width — on a phone the figure is a long scroll. */}
      <figcaption className="border-rule border-b px-[18px] pt-[14px] pb-[13px] sm:px-[22px]">
        <p className="font-mono text-meta-3 text-[9px] tracking-[0.14em] uppercase">
          Note · {SPECIMEN_DURATION} · 3 speakers
        </p>
        <p className="font-header text-ink mt-[5px] text-[17px] leading-[1.3] font-semibold text-balance">
          {SPECIMEN_TITLE}
        </p>
        <p className="text-muted mt-[6px] max-w-[62ch] text-[12px] leading-[1.5] text-pretty">
          A real note from a 3-minute planning call, run through the pipeline. Its time
          links were matched by hand for this page. Select one to see the line it came
          from.
        </p>
      </figcaption>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,272px)]">
        <div className="flex flex-col gap-[18px] px-[18px] pt-[16px] pb-[20px] sm:px-[22px]">
          <section>
            <Label>Summary</Label>
            <p className="text-ink-prose text-[13.5px] leading-[1.62] text-pretty">{SPECIMEN_SUMMARY}</p>
          </section>
          <section>
            <Label>Takeaways · 3 of 5</Label>
            <Claims claims={SPECIMEN_TAKEAWAYS} numbered />
          </section>
          <section>
            <Label>Action items · 2 of 4</Label>
            <Claims claims={SPECIMEN_ACTIONS} numbered={false} />
          </section>
        </div>

        <section
          aria-label="Transcript, the cited lines"
          className="bg-pane border-rule border-t md:border-t-0 md:border-l"
        >
          <p className="font-mono text-muted px-[18px] pt-[14px] pb-[6px] text-[8.5px] tracking-[0.16em] uppercase">
            Transcript · cited lines
          </p>
          <ol className="pb-[10px]">
            {SPECIMEN_SEGMENTS.map((seg, i) => (
              <li
                key={seg.id}
                id={segmentAnchor(seg.id)}
                className={[
                  "target:border-l-accent target:bg-seg-wash grid scroll-mt-[35vh] grid-cols-[26px_1fr] gap-2.5 border-l-2 border-transparent py-[8px] pr-[16px] pl-3.5",
                  // A gap in the recording between two shown lines is marked
                  // with a rule, so the excerpt never reads as continuous.
                  // Dashed on the top edge only: `border-dashed` would dash the
                  // 2px left rule too, and the active line's rule is solid.
                  i > 0 && seg.id !== SPECIMEN_SEGMENTS[i - 1].id + 1 ? "border-t-rule-2 border-t [border-top-style:dashed]" : "",
                ].join(" ")}
              >
                <SpeakerAvatar speaker={seg.speaker} />
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2">
                    <span className={`text-[12px] leading-[16px] ${SPEAKER_TEXT[seg.speaker.token]}`}>
                      {seg.speaker.name}
                    </span>
                    {/* meta-3, not the app's meta-4: meta-4 measures 4.20:1 on pane. */}
                    <span className="font-mono text-meta-3 text-[9.5px] tabular-nums">{seg.time}</span>
                  </p>
                  <p className="text-ink-2 mt-[3px] text-[12.5px] leading-[1.55] text-pretty">{seg.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </figure>
  );
}
