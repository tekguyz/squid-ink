/** Uppercase section label followed by a hairline that fills the row. */
export function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-2.5 max-md:pb-[8px]">
      <h2 className="font-mono text-[8.5px] tracking-[0.16em] uppercase text-muted max-md:text-[11px] max-md:tracking-[0.1em]">
        {label}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-rule-2" />
    </div>
  );
}
