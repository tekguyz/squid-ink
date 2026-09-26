/** The four personas every new account is given, as
 *  supabase/schemas/persona_provisioning.sql writes them. Two quick actions
 *  each, not four: this is a sample, and the table has to fit a phone.
 *  `__tests__/specimen.test.ts` fails if any of it stops matching the SQL. */
export const LANDING_PERSONAS = [
  {
    name: "Neutral Analyst",
    sub: "dense · no framing",
    actions: ["Extract decisions only", "Unanswered questions"],
  },
  {
    name: "Sales Coach",
    sub: "coaching · direct",
    actions: ["Score objection handling", "Draft follow-up email"],
  },
  {
    name: "Investor",
    sub: "economics · risk",
    actions: ["Unit-economics read", "Diligence questions"],
  },
  {
    name: "Engineering Lead",
    sub: "scope · sequencing",
    actions: ["Sequencing plan", "Handoff brief"],
  },
] as const;

export function PersonaTable() {
  return (
    <div role="table" aria-label="The four default personas" className="border-rule border-t">
      <div
        role="row"
        className="border-rule font-mono text-muted grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-[14px] border-b py-[8px] text-[8.5px] tracking-[0.16em] uppercase max-md:sr-only md:grid-cols-[168px_150px_minmax(0,1fr)]"
      >
        <span role="columnheader">Persona</span>
        <span role="columnheader">Reads for</span>
        <span role="columnheader">Quick actions</span>
      </div>
      {LANDING_PERSONAS.map((p) => (
        <div
          key={p.name}
          role="row"
          className="border-rule-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-[14px] gap-y-[4px] border-b py-[11px] md:grid-cols-[168px_150px_minmax(0,1fr)]"
        >
          <span role="cell" className="font-header text-ink text-[15px] font-semibold">
            {p.name}
          </span>
          <span role="cell" className="font-mono text-meta-3 text-[10px] tracking-[0.04em]">
            {p.sub}
          </span>
          <span role="cell" className="text-ink-2 text-[13px] leading-[1.5] max-md:col-span-2">
            {p.actions.join(" · ")}
          </span>
        </div>
      ))}
    </div>
  );
}
