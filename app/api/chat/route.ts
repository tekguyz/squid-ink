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

  // 4. Persist the user's turn, then read history back. The insert lands
  //    first so the newest message is part of the history we send.
  await ports.insertUserMessage(noteId, user.id, text, scope);
  const history = trimHistory(await ports.readHistory(noteId));

  // 5. Build this turn's context from THIS turn's scope. Nothing is carried.
  const anthropic = createAnthropic({
    apiKey: anthropicKey,
    ...(workspaceId
      ? { headers: { "anthropic-workspace-id": workspaceId } }
      : {}),
  });
  const flat = flattenHistory(history);

  let system = ALL_NOTES_SYSTEM;
  let messages: ModelMessage[] = flat as ModelMessage[];
  let tools: Record<string, ReturnType<typeof createSearchTool>> | undefined;

  if (scope === "this_note") {
    const noteContext = await ports.readNoteContext(noteId);
    if (!noteContext) return bad(404, "Note not found.");

    system = THIS_NOTE_SYSTEM;
    const older = flat.slice(0, -1) as ModelMessage[];
    const newest = flat.at(-1);

    messages = [
      ...older,
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildTranscriptBlock(noteContext),
            // The 5-minute breakpoint. Byte-stable across turns, so a
            // multi-turn conversation pays full input price for the
            // transcript once.
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          { type: "text", text: newest?.content ?? text },
        ],
      },
    ];
  } else {
    const voyageKey = process.env.VOYAGE_API_KEY;
    if (!voyageKey) return bad(500, "Search is not configured.");

    tools = {
      searchNotes: createSearchTool({
        embedQuery: createVoyageQueryEmbedder(voyageKey),
        rpc: (vector, query) => ports.searchRpc(vector, query),
      }),
    };
  }

  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages,
    // Sonnet 5 removed budget_tokens and answers 400 if it is sent.
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
    ...(tools ? { tools, stopWhen: isStepCount(5) } : {}),
    onFinish: async ({ text: answer, steps }) => {
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

  // sendReasoning is deliberately NOT set. Reasoning is a separate part type
  // and the renderer ignores it, but leaving it off keeps chain-of-thought off
  // the wire entirely.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
