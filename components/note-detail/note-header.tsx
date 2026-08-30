export function NoteHeader({ meta, title }: { meta: string; title: string }) {
  return (
    <header className="px-[26px] pt-5 pb-[15px]">
      <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-meta">
        {meta}
      </p>
      <h1 className="mt-[7px] font-header text-[29px] font-medium leading-[1.14] tracking-[-0.012em]">
        {title}
      </h1>
    </header>
  );
}
