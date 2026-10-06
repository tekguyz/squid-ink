import { DEMO_MAX_QUESTIONS_PER_VISITOR } from "@/lib/chat/limits";

/**
 * Demo mode's side of the chat panel (issue #19): the questions a visitor has
 * left, and the route's refusals in its own words. Split out of chat-panel.tsx
 * to keep that file under the 250-line soft ceiling.
 *
 * The route is what enforces the caps. Everything here only shows them.
 */

/** What the route said when it refused, in its own words. The transport throws
 *  the response body as the error's message, and the route answers every
 *  refusal as `{ error }` JSON — so the demo's caps read as what they are
 *  rather than as something broken. Anything else gets the generic line. */
export function refusalText(error: Error): string | null {
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/** The count the page was read with, less what this session has asked, so the
 *  number moves on the press rather than on the next page load. A question
 *  that ended in an error does not count: the route either refused it before
 *  it became a row or rolled the row back, so the server did not count it
 *  either. Null for a real account. */
export function questionsLeftNow(
  atLoad: number | null,
  asked: number,
  failed: boolean,
): number | null {
  if (atLoad === null) return null;
  return Math.max(0, atLoad - (failed ? asked - 1 : asked));
}

/** The count is a mono label; the sentence that replaces it at zero is prose,
 *  so it reads as prose rather than as 9px capitals. */
export function DemoQuestionsLine({ left }: { left: number }) {
  return left === 0 ? (
    <p className="pt-1.5 text-[11.5px] leading-[1.5] text-ink-2 max-md:text-[13px]">
      You have used all {DEMO_MAX_QUESTIONS_PER_VISITOR} demo questions. Everything else on the
      page still works.
    </p>
  ) : (
    <p className="pt-1 font-mono text-[9px] uppercase tracking-[0.06em] text-meta tabular-nums max-md:pt-[3px] max-md:text-[11px]">
      {left} of {DEMO_MAX_QUESTIONS_PER_VISITOR} demo questions left
    </p>
  );
}
