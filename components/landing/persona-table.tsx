/** The four personas every new account is given, as
 *  supabase/schemas/persona_provisioning.sql writes them. No quick actions:
 *  the buttons exist in the app but run nothing yet, so listing them here
 *  would claim a feature. `__tests__/specimen.test.ts` fails if any of it
 *  stops matching the SQL. */
export const LANDING_PERSONAS = [
  {
    name: "Neutral Analyst",
    sub: "dense · no framing",
  },
  {
    name: "Sales Coach",
    sub: "coaching · direct",
  },
  {
    name: "Investor",
    sub: "economics · risk",
  },
  {
    name: "Engineering Lead",
    sub: "scope · sequencing",
  },
] as const;

export function PersonaTable() {
  return (
    <div role="table" aria-label="The four default personas" className="border-rule border-t">
      <div
        role="row"
        className="border-rule font-mono text-muted grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-[14px] border-b py-[8px] text-[8.5px] tracking-[0.16em] uppercase max-md:sr-only md:grid-cols-[200px_minmax(0,1fr)]"
      >
        <span role="columnheader">Persona</span>
        <span role="columnheader">Reads for</span>
      </div>
      {LANDING_PERSONAS.map((p) => (
        <div
          key={p.name}
          role="row"
          className="border-rule-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-[14px] border-b py-[11px] md:grid-cols-[200px_minmax(0,1fr)]"
        >
          <span role="cell" className="font-header text-ink text-[15px] font-semibold">
            {p.name}
          </span>
          <span role="cell" className="font-mono text-meta-3 text-[9.5px] tracking-[0.08em] uppercase">
            {p.sub}
          </span>
        </div>
      ))}
    </div>
  );
}
