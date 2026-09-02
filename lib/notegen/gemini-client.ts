import type { DepthPlan } from "@/lib/notegen/depth-policy";
import type { LensPrompt } from "@/lib/notegen/lens-prompts";
import type { GeneratedNote } from "@/lib/notegen/persist-result";

/** The ONLY module in this track that knows Gemini's wire format.
 *
 *  Everything below the NoteGenerator boundary speaks GeneratedNote, so
 *  replacing the provider is a change to this file and nothing else — the same
 *  boundary lib/transcription/gemini-client.ts draws.
 *
 *  Every shape below was read from node_modules/@google/genai/dist/genai.d.ts
 *  at the pinned 2.19.0 on 2026-09-02, and the model id from the live models
 *  endpoint the same day. None of it is recalled, and none is copied from the
 *  published samples. Three details are load-bearing:
 *
 *  1. response_format IS TOP LEVEL on interactions.create, not inside
 *     generation_config (CreateModelInteraction, :2803). Its shape is
 *     { type: "text", mime_type: "application/json", schema }
 *     (TextResponseFormat_2, :14365). The sibling top-level response_mime_type
 *     is marked @deprecated in these same types and is not sent.
 *  2. generation_config.thinking_level takes the LOWERCASE union
 *     "minimal" | "low" | "medium" | "high" (:6251, :14439). The
 *     SCREAMING_CASE ThinkingLevel enum (:14409) belongs to the camelCase
 *     models.generateContent surface and is a 400 here. depth-policy.ts owns
 *     that mapping and has a test asserting the casing.
 *  3. THE CASING SPLIT IS REAL AND IS NOT A MISTAKE. interactions.create takes
 *     snake_case throughout; the Files API takes camelCase. This file only
 *     touches interactions, so everything here is snake_case. Do not "make it
 *     consistent" with the upload call in the transcription client.
 *
 *  TEXT ONLY. This pipeline never fetches, never re-sends and never sees the
 *  source audio. DECISIONS.md § "Structured note generation" fixes that for
 *  all four lenses in MVP; audio-native input for the Sales Coach lens is
 *  named there as a future option, not built.
 *
 *  CONTEXT IS NOT A CONSTRAINT, AND THIS WAS CHECKED RATHER THAN ASSUMED. The
 *  live model card gives gemini-3.7-flash an inputTokenLimit of 1,048,576. The
 *  longest transcript that can reach here is 60 minutes — the ceiling
 *  lib/transcription/diarization-policy.ts already enforces upstream — which
 *  is roughly 9,000 words at 150 wpm, near 12,000 tokens with speaker tags.
 *  Three orders of magnitude of headroom, so there is no chunking path here
 *  and none is owed. */

export const GEMINI_NOTEGEN_MODEL = "gemini-3.7-flash";

export interface NoteGenRequest {
  transcript: string;
  lens: LensPrompt;
  plan: DepthPlan;
}

export type NoteGenerator = (request: NoteGenRequest) => Promise<GeneratedNote>;

/** What each scope asks for, beyond the lens framing. Depth changes what the
 *  model does, not merely how much it writes — see depth-policy.ts. */
const SCOPE_INSTRUCTIONS: Record<DepthPlan["scope"], string> = {
  "decisions-and-actions":
    "Extract only two things: the decisions actually taken, and the action " +
    "items. Write no summary. Omit discussion that reached no decision. If " +
    "nothing was decided, return empty arrays rather than inventing content.",

  balanced:
    "Produce three things at even weight: a short summary of what the " +
    "conversation was and where it landed, the takeaways worth remembering, " +
    "and the action items. Keep each takeaway to one idea.",

  "cross-referenced":
    "Produce a summary, takeaways and action items, and do the analytical " +
    "work a shorter reading would skip. Cross-reference the takeaways " +
    "against each other and against the summary, naming where they reinforce " +
    "or contradict one another. Infer action items that were clearly implied " +
    'by what was agreed but never stated as a task, and mark an inferred one ' +
    'by beginning it with "Implied: ". Do not invent commitments nobody made.',
};

export function systemPromptFor(lens: LensPrompt, plan: DepthPlan): string {
  return [
    `You are reading a meeting transcript as the ${lens.label}.`,
    "",
    lens.framing,
    "",
    SCOPE_INSTRUCTIONS[plan.scope],
    "",
    "Ground every statement in the transcript. Do not speculate about what " +
      "was meant, and do not add advice that was not discussed. Where a " +
      "speaker is identified you may attribute; where speakers are " +
      "unlabelled, do not guess who said what.",
    "",
    "Return JSON matching the provided schema and nothing else.",
  ].join("\n");
}

export function responseSchemaFor(plan: DepthPlan): Record<string, unknown> {
  const stringArray = { type: "array", items: { type: "string" } };

  // Brief produces no summary, so the field is absent from the schema rather
  // than present-but-nullable. A nullable field the prompt separately tells
  // the model to leave empty is two instructions that can disagree.
  const properties: Record<string, unknown> = plan.wantsSummary
    ? {
        summary: { type: "string" },
        takeaways: stringArray,
        action_items: stringArray,
      }
    : { takeaways: stringArray, action_items: stringArray };

  return { type: "object", properties, required: Object.keys(properties) };
}

/** Only strings survive. A model that returns a number, a null or a nested
 *  object in one of these arrays must not put it into a not-null text column. */
function stringsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Pure, exported and tested without the SDK — the same reason
 *  segmentsFromInteraction is exported from the transcription client. */
export function parseGeneratedNote(rawText: string): GeneratedNote {
  // response_format should make the fence impossible. Tolerating it is cheap;
  // being surprised by it in production costs a whole call.
  const body = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // The offending text is in the message because there is no error column at
    // this scale — the Vercel function log is where a failure is read, so it
    // has to carry enough to diagnose from.
    throw new Error(
      `Gemini did not return JSON for note generation: ${body.slice(0, 200)}`,
    );
  }

  // A JSON `null` body parses fine and would then throw on property access.
  const record = (parsed ?? {}) as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary : null;

  return {
    summary,
    takeaways: stringsFrom(record.takeaways),
    actionItems: stringsFrom(record.action_items),
  };
}

export function createGeminiNoteGenerator(apiKey: string): NoteGenerator {
  return async ({ transcript, lens, plan }: NoteGenRequest) => {
    // Imported lazily so the pure parser above is unit-testable without
    // loading the SDK, and so the SDK never reaches a client bundle by
    // accident. Same reasoning as the transcription client.
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });

    // Inline text, not the Files API. A 60-minute transcript is tens of
    // kilobytes — the upload indirection the audio path needs buys nothing
    // here and would only add a failure mode.
    const interaction = (await client.interactions.create({
      model: GEMINI_NOTEGEN_MODEL,
      system_instruction: systemPromptFor(lens, plan),
      input: [{ type: "text", text: transcript }],
      // TOP LEVEL. Not inside generation_config — see the header.
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchemaFor(plan),
      },
      generation_config: { thinking_level: plan.thinkingLevel },
    })) as { output_text?: string };

    const rawText = interaction.output_text?.trim() ?? "";
    if (!rawText) {
      // Two causes land here and this message cannot tell them apart: the
      // model genuinely returned nothing, or the SDK renamed output_text and
      // the cast above erased the real return type. If this fires on a
      // transcript you can read, suspect the wire shape first — log the raw
      // interaction and compare it against genai.d.ts.
      throw new Error(
        "Gemini returned no note-generation output (empty result, or output_text moved)",
      );
    }

    return parseGeneratedNote(rawText);
  };
}
