import { planForDepth } from "@/lib/notegen/depth-policy";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { persistGeneratedNote } from "@/lib/notegen/persist-result";
import type { GeneratableRow, NotegenPorts } from "@/lib/notegen/sweep";

/** ONE note, from eligible to a terminal state. Both triggers call this: the
 *  cron sweep's second phase, and the deferred block of the manual Transcribe
 *  action once transcription succeeds.
 *
 *  It is a separate module from sweep.ts for the reason the transcription
 *  track split transcribe-note.ts out of its own sweep: two copies of the
 *  claim would be two sources of truth that can disagree, and the
 *  disagreement would cost a Gemini call.
 *
 *  WHAT IS NOT HERE, DELIBERATELY: age. Staleness is a sweep-only concern.
 *  There is also no failOnMissingObject flag, which the transcription claim
 *  needs and this one does not — there is no object. This pipeline is
 *  text-only and the transcript is already on the row it just claimed, so both
 *  callers take the identical path with no options at all. */

export type ClaimOutcome =
  /** This caller's UPDATE was the one that matched. It now owns the row. */
  | "claimed"
  /** The guarded UPDATE matched zero rows: another invocation moved the row
   *  first, or it was never eligible. NOT an error — and never a model call. */
  | "contended"
  /** Claimed, then found to hold no usable transcript. Terminal, and still
   *  never a model call. */
  | "blank";

export type NotegenOutcome = ClaimOutcome | "generated" | "failed";

/** The claim's answer, carrying the persona the claim itself returned.
 *
 *  An object rather than the bare ClaimOutcome string it used to be, for the
 *  same reason ClaimResult is tagged: the persona is nullable and so is "no
 *  result", and a caller must never tell those apart by a truthiness check.
 *  ClaimOutcome survives as the `outcome` field's type because the sweep's
 *  counters key on exactly those three strings. */
export type ClaimResolution =
  | { outcome: "claimed"; personaId: string | null }
  | { outcome: "contended" }
  | { outcome: "blank" };

/** Narrower than NotegenPorts so a caller cannot reach the generator from the
 *  claim. store is included because a blank transcript is failed here. */
export type ClaimPorts = Pick<
  NotegenPorts,
  "claimForGeneration" | "log" | "store"
>;

/** The generating half. Only ever called on a row this process just claimed. */
export type GeneratePorts = Pick<
  NotegenPorts,
  "log" | "resolvePersona" | "generate" | "store"
>;

export async function claimNoteForGeneration(
  ports: ClaimPorts,
  row: GeneratableRow,
): Promise<ClaimResolution> {
  // THE claim, through the one implementation in notegen-ports.ts. The guard
  // it carries — processing_status = 'completed' AND notegen_status IS NULL —
  // is what makes "cannot generate notes before a transcript exists" true by
  // construction rather than by caller discipline.
  //
  // It also hands back the note's persona_id, read from its own RETURNING. See
  // ClaimResult: the lens is frozen at the instant this UPDATE matches.
  const claim = await ports.claimForGeneration(row.id);
  if (claim.status !== "claimed") return { outcome: "contended" };

  // Blankness is checked AFTER the claim, not before, and that is deliberate.
  // Checking first would leave the row eligible forever, so every sweep would
  // re-examine it and a handful of permanently blank rows could starve real
  // work out of the per-run cap. Claiming then failing is terminal and
  // self-clearing. The guarantee that matters is unchanged: this is still
  // before any model call.
  //
  // It also means a LOST claim never reaches this branch, so a blank row we do
  // not own can never be failed over the winner's 'generating'.
  const transcript = row.raw_transcript?.trim();
  if (!transcript) {
    ports.log(
      `note ${row.id}: completed with no usable transcript. ` +
        `Marked 'failed' without a model call.`,
    );
    await ports.store.failNotegen(row.id);
    return { outcome: "blank" };
  }

  return { outcome: "claimed", personaId: claim.personaId };
}

export async function generateClaimedNote(
  ports: GeneratePorts,
  row: GeneratableRow,
  /** From the claim's own RETURNING, never a fresh read. Null means the note
   *  carries no lens — every note written before 2026-09-02 — and resolution
   *  falls to the default slug exactly as it always did. */
  personaId: string | null,
): Promise<"generated" | "failed"> {
  try {
    // The note's own lens first, then the neutral-analyst slug, then the
    // fallback. The user_id filter is application-level, which the standing
    // rule forbids everywhere else; it is the one deliberate exception,
    // because the cron caller runs as service_role and bypasses RLS, so an
    // unfiltered lookup can return another account's row. See CLAUDE.md
    // § Data and lib/notegen/resolve-persona.ts.
    const persona = await ports.resolvePersona(row.user_id, personaId);
    const plan = planForDepth(persona.depth);
    const lens = lensPromptFor(persona.slug);

    const note = await ports.generate({
      // Non-null: claimNoteForGeneration returned 'blank' for anything else,
      // and this function is only ever called after a 'claimed'.
      transcript: row.raw_transcript!.trim(),
      lens,
      plan,
    });

    const persisted = await persistGeneratedNote({
      store: ports.store,
      noteId: row.id,
      userId: row.user_id,
      note,
    });

    // The resolution path is named here rather than inferred later. Which
    // branch ran is a question the build report has to answer with evidence.
    ports.log(
      `note ${row.id}: generated under ${lens.label} ` +
        `(${persona.depth}/${plan.thinkingLevel}, persona from ${persona.source}) — ` +
        // What the ROW carries, not what the model returned. "kept" means the
        // null-guard refused the write because the note was already named —
        // the guarantee this pipeline owes, so the log has to be able to say
        // it happened.
        `title=${persisted.title}, ` +
        `summary=${note.summary ? "yes" : "no"}, ` +
        `${note.takeaways.length} takeaway(s), ` +
        `${note.actionItems.length} action item(s).`,
    );
    return "generated";
  } catch (error) {
    // No error-message column at single-owner scale. The Vercel function log
    // is where a failure is read, so the reason has to reach it. This also
    // catches a persona lookup throwing — "permission denied for table
    // personas" must not leave the row stuck at 'generating' for an hour with
    // nothing saying why.
    const reason = error instanceof Error ? error.message : String(error);
    ports.log(`note ${row.id}: note generation failed — ${reason}`);
    await ports.store.failNotegen(row.id);
    return "failed";
  }
}

/** The whole unit in one call.
 *
 *  Unlike the transcription track, BOTH shipped callers use this composed
 *  form. The sweep's cap counts model attempts, and here every cheap rejection
 *  — contended, blank — is already distinguishable from the returned outcome,
 *  so there is nothing useful to do between the two halves. */
export async function claimAndGenerate(
  ports: ClaimPorts & GeneratePorts,
  row: GeneratableRow,
): Promise<NotegenOutcome> {
  const claim = await claimNoteForGeneration(ports, row);
  if (claim.outcome !== "claimed") return claim.outcome;
  return generateClaimedNote(ports, row, claim.personaId);
}
