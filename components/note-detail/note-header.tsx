export function NoteHeader({ meta, title }: { meta: string; title: string }) {
  return (
    <header className="px-[26px] pt-5 pb-[15px] max-md:px-[16px] max-md:pt-[12px] max-md:pb-[8px]">
      <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-meta max-md:text-[11px] max-md:tracking-[0.1em]">
        {meta}
      </p>
      <h1 className="mt-[7px] font-header text-[29px] text-pretty font-medium leading-[1.14] tracking-[-0.012em] max-md:mt-[5px] max-md:text-[22px] max-md:leading-[1.25]">
        {title}
      </h1>
    </header>
  );
}
