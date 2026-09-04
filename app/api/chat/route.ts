/** Ask-your-notes chat.
 *
 *  Gates in cheapest-first order, so an abusive or broken client is refused
 *  before anything is spent. See
 *  docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md § 4.
 *
 *  This is the ONLY shipped file that reads ANTHROPIC_API_KEY, and the third
 *  and last that reads VOYAGE_API_KEY. project-conventions.test.ts fails the
 *  build if either stops being true.
 */

import {
  streamText,
  isStepCount,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type ModelMessage,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createChatPorts } from "@/lib/chat/ports";
import { citationsFromSteps } from "@/lib/chat/citations";
import {
  overLengthCap,
  trimHistory,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES_PER_WINDOW,
} from "@/lib/chat/limits";
import {
  buildTranscriptBlock,
  flattenHistory,
  THIS_NOTE_SYSTEM,
  ALL_NOTES_SYSTEM,
} from "@/lib/chat/context";
import { createVoyageQueryEmbedder } from "@/lib/rag/query-embed";
import { createSearchTool } from "@/lib/rag/search-tool";
import type { ChatScope } from "@/lib/chat/types";

/** A chat turn is seconds, not minutes. Well inside Vercel Hobby's 300 s hard
 *  ceiling — see docs/DEPLOYMENT.md for how that number was measured. */
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";

const bad = (status: number, message: string) =>
  Response.json({ error: message }, { status });

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    // Every port throws on a Postgres error. Without this the route returns
    // Next's HTML 500 and breaks its own JSON contract, so the client shows a
    // parse failure instead of the banner.
    console.error("[chat] request failed", error);
    return bad(500, "Something went wrong answering that.");
  }
}

async function handle(req: Request) {
  // 1. Auth. The session middleware already protects this path; this is the
  //    in-route half, so a fetch gets JSON rather than a login page's HTML.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad(401, "Sign in to use chat.");

  // The client posts its whole message array. We take the newest message and
  // the scope, and NOTHING else — history is re-read from the database below,
  // which is what makes the 20-turn bound structural rather than cooperative.
  const payload = (await req.json().catch(() => null)) as {
    noteId?: string;
    scope?: ChatScope;
    text?: string;
  } | null;

  const noteId = payload?.noteId;
  const text = payload?.text ?? "";
  const scope: ChatScope =
    payload?.scope === "all_notes" ? "all_notes" : "this_note";

  if (!noteId) return bad(400, "Missing note.");
  if (text.trim().length === 0) return bad(400, "Ask a question first.");

  // 2. Length cap, before any embedding and any model call.
  if (overLengthCap(text)) {
    return bad(
      400,
      `That message is too long. Keep it under ${MAX_MESSAGE_CHARS} characters.`,
    );
  }

  const ports = createChatPorts(supabase);

  // 3. Rate limit. One query against a table this feature already creates.
  const recent = await ports.countRecentUserMessages();
  if (recent >= MAX_MESSAGES_PER_WINDOW) {
    return bad(
      429,
      "You are sending messages faster than this can answer them. " +
        "Wait a minute and try again.",
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return bad(500, "Chat is not configured.");

  // An IDENTITY-LINKED key is scoped to a person rather than a workspace, and
  // the API answers 400 unless every request names the workspace it acts in.
  // A plain workspace-scoped key needs no such header, so this is sent only
  // when the variable is set rather than always. Measured 2026-09-03 against
  // the live API: without it, "anthropic-workspace-id is required when
  // authenticating with an identity-linked API key".
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;

  const voyageKey = scope === "all_notes" ? process.env.VOYAGE_API_KEY : null;
  if (scope === "all_notes" && !voyageKey) {
    return bad(500, "Search is not configured.");
  }

  // 4. Read the note BEFORE persisting anything. RLS returns null for a note
  //    the caller does not own, so this doubles as the ownership check — and
  //    doing it first means a bad note id cannot burn a rate-limit slot or
  //    leave an orphaned row behind.
  const noteContext =
    scope === "this_note" ? await ports.readNoteContext(noteId) : null;
  if (scope === "this_note" && !noteContext) return bad(404, "Note not found.");

  // 5. Persist the user's turn, then read history back. The insert lands
  //    first so the newest message is part of the history we send.
  const userMessageId = await ports.insertUserMessage(
    noteId,
    user.id,
    text,
    scope,
  );
  const history = trimHistory(await ports.readHistory(noteId));

  // 6. Build this turn's context from THIS turn's scope. Nothing is carried.
  const anthropic = createAnthropic({
    apiKey: anthropicKey,
    ...(workspaceId
      ? { headers: { "anthropic-workspace-id": workspaceId } }
      : {}),
  });
  const flat = flattenHistory(history) as ModelMessage[];

  let system = ALL_NOTES_SYSTEM;
  let messages: ModelMessage[] = flat;
  let tools: Record<string, ReturnType<typeof createSearchTool>> | undefined;

  if (noteContext) {
    system = THIS_NOTE_SYSTEM;

    // The transcript goes FIRST, ahead of all history.
    //
    // Anthropic caching is a prefix match from the start of the request. With
    // the block after the history, turn 2 sends system + q1 + a1 + transcript
    // and diverges from turn 1's cached prefix immediately after `system` —
    // so the cache never reads and every turn re-pays for the whole
    // transcript. Leading it makes the cached prefix `system + transcript`,
    // which is byte-identical on every turn of the conversation.
    //
    // The provider merges consecutive same-role messages, so this block and
    // the first user question coalesce into one turn; the breakpoint stays at
    // the end of the transcript text either way.
    messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildTranscriptBlock(noteContext),
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
      },
      ...flat,
    ];
  } else {
    tools = {
      searchNotes: createSearchTool({
        embedQuery: createVoyageQueryEmbedder(voyageKey!),
        rpc: (vector, query) => ports.searchRpc(vector, query),
      }),
    };
  }

  // Flipped by onFinish. Read by the rollback in consumeStream's onError.
  let answered = false;

  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages,
    // Sonnet 5 removed budget_tokens and answers 400 if it is sent.
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
    ...(tools ? { tools, stopWhen: isStepCount(5) } : {}),
    onFinish: async ({ text: answer, steps, usage }) => {
      // Set BEFORE the insert is awaited. onError and onFinish can both fire
      // when a stream dies after some text arrived, and the rollback below
      // must not delete a question that did get answered.
      answered = true;

      // One line, kept deliberately. The cache is invisible otherwise: the
      // breakpoint can stop hitting from a change nowhere near this file and
      // nothing would fail, only the bill would move. Read it in the Vercel
      // function log, the same place transcription failures are read.
      console.log(
        `[chat] scope=${scope} in=${usage?.inputTokens ?? "?"} ` +
          `cacheRead=${usage?.inputTokenDetails?.cacheReadTokens ?? 0} ` +
          `cacheWrite=${usage?.inputTokenDetails?.cacheWriteTokens ?? 0} ` +
          `out=${usage?.outputTokens ?? "?"}`,
      );

      try {
        await ports.insertAssistantMessage(
          noteId,
          user.id,
          answer,
          scope,
          citationsFromSteps(steps ?? []),
        );
      } catch (error) {
        // The answer has already streamed. Losing the persisted copy is bad;
        // throwing here would also break the stream, which is worse.
        console.error("[chat] failed to persist the assistant turn", error);
      }
    },
  });

  // Consume the stream independently of the HTTP response. Without this,
  // closing the tab mid-answer cancels the only reader, onFinish never runs,
  // and the thread is left ending on a user turn with no reply and no log
  // line. Fire-and-forget: the response below still streams normally.
  //
  // onError is the ROLLBACK. The user's turn is persisted at step 5, before
  // this call, because the rate limit counts rows in chat_messages and a
  // question that is not a row is a question that is not counted. The cost of
  // that ordering is that a failed model call leaves a question in the thread
  // with no reply, forever — nothing else deletes it, and it is re-sent as
  // history on every later turn. Undoing the one insert we know the id of is
  // the smallest fix that keeps the thread honest.
  //
  // The `answered` guard is what stops this deleting a question that DID get
  // an answer: a stream that dies after some text arrived reaches onFinish
  // too, and removing the user turn under a persisted assistant turn would
  // trade one orphan for a worse one.
  //
  // Deliberately NOT re-counted against the rate limit. A caller hammering a
  // broken model can now retry without being throttled by their own failures,
  // which is the right trade at single-owner scale and is recorded in
  // docs/KNOWN_GAPS.md.
  void result.consumeStream({
    onError: (error) => {
      console.error("[chat] stream failed", error);
      if (answered) return;
      void ports.deleteMessage(userMessageId).catch((cleanupError) => {
        // Best effort. The thread keeps a dangling question, which is the
        // pre-2026-09-04 behaviour rather than a new failure mode.
        console.error("[chat] failed to roll back the user turn", cleanupError);
      });
    },
  });

  // sendReasoning DEFAULTS TO TRUE in ai 7.0.92 — read from
  // node_modules/ai/dist/index.js:7932, not from the docs, which describe it
  // as opt-in. Omitting it would forward reasoning deltas to the browser.
  // The renderer ignores them and Sonnet 5's thinking.display defaults to
  // "omitted", so nothing leaks today; this is the layer that stops it
  // silently starting to.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: false }),
  });
}
