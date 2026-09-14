import type { ReactNode } from "react";

/**
 * One section of the Settings scroll: App Surfaces 06's page header (Bitter
 * 22px title, 13px lede, rule underneath), repeated per section because the
 * page is one continuous scroll rather than one section at a time.
 *
 * The `id` is the anchor the left nav links to. Presentational; no state.
 */
export function SectionFrame({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`}>
      <header className="border-rule border-b px-[26px] pt-[20px] pb-[14px]">
        <h2
          id={`${id}-title`}
          className="font-header text-ink text-[22px] font-semibold tracking-[-0.01em]"
        >
          {title}
        </h2>
        <p className="font-body text-muted mt-[5px] text-[13px]">{lede}</p>
      </header>
      <div className="px-[26px] pb-[22px]">{children}</div>
    </section>
  );
}

/** 06's small-caps group heading ("Appearance", "Capture defaults"). */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-meta-4 mt-[22px] text-[8.5px] tracking-[0.16em] uppercase">
      {children}
    </p>
  );
}

/** The honest empty state for a nav destination with nothing built behind it.
 *  No control, no stub action — a destructive-sounding label with a fake
 *  button under it is worse than saying nothing is there. */
export function NotBuiltYet({ children }: { children: ReactNode }) {
  return (
    <div className="py-[15px]">
      <p className="font-mono text-meta-2 text-[9.5px] tracking-[0.06em] uppercase">
        Nothing built here yet
      </p>
      <p className="font-body text-muted mt-[6px] max-w-[560px] text-[12.5px] leading-[1.5]">
        {children}
      </p>
    </div>
  );
}
