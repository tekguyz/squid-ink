import Link from "next/link";

/**
 * The 404 page, for an unknown route and for every `notFound()` call — a note
 * id that is malformed, or that RLS hides because another account owns it.
 * The two read the same on purpose: saying "that note exists but is not
 * yours" would leak its existence.
 *
 * No drawing exists for this page. It borrows the Auth sheet's frame (one
 * paper sheet on the canvas, the mark at the top) so an error still looks
 * like Squid Ink, and adds nothing the design system does not already have.
 */
export const metadata = { title: "Not found" };

const FOCUS = "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

export default function NotFound() {
  return (
    <main className="bg-canvas text-ink flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-paper border-rule flex w-full max-w-[392px] flex-col border px-[32px] py-[34px]">
        <p className="font-header text-ink flex items-center gap-[8px] text-[15px] font-bold tracking-[-0.01em]">
          <span aria-hidden="true" className="bg-accent h-[18px] w-[18px]" />
          Squid Ink
        </p>
        <p className="font-mono text-muted mt-[26px] mb-[8px] text-[9px] tracking-[0.14em] uppercase">
          404 · Not found
        </p>
        <h1 className="font-header text-ink text-[25px] leading-[1.2] font-semibold">
          Nothing here
        </h1>
        <p className="font-body text-muted mt-[9px] text-[13px] leading-[1.6] text-pretty">
          This page or note does not exist, or it is not in your account. Check
          the link, or go back to your notes.
        </p>
        <Link
          href="/"
          className={`bg-accent text-on-accent hover:bg-accent-pressed font-mono mt-[22px] block w-full py-[10px] text-center text-[10.5px] font-medium tracking-[0.08em] uppercase ${FOCUS}`}
        >
          All notes
        </Link>
      </div>
    </main>
  );
}
