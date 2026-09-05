"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatScope, ChatTurn, Citation } from "@/lib/chat/types";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import { ChatMessage } from "./chat-message";
import { ScopeToggle } from "./scope-toggle";

/** One row of the search tool's output, as the tool returns it. Narrowed here
 *  rather than trusted, because it crosses the wire as JSON. */
interface ToolResultRow {
  citeKey: string;
  chunkId: string;
  noteId: string;
  noteTitle: string;
  chunkType: string;
  tsStart: string | null;
}

/** Live citations for a turn still in flight come from that turn's own tool
 *  result. After a reload they come from chat_messages.metadata instead —
 *  same shape, different source. */
function liveCitations(parts: { type: string; [k: string]: unknown }[]): Citation[] {
  return parts.flatMap((part) => {
    if (part.type !== "tool-searchNotes" || part.state !== "output-available") {
      return [];
    }
    const output = part.output as { results?: ToolResultRow[] } | undefined;
    return (output?.results ?? []).map((r) => ({
      key: r.citeKey,
      chunkId: r.chunkId,
      noteId: r.noteId,
      noteTitle: r.noteTitle,
      chunkType: r.chunkType,
      tsStart: r.tsStart,
    }));
  });
}

/** Groups the digits: 4,000 rather than 4000. Fixed to en-US rather than
 *  the runtime locale, because a locale-dependent string differs between
 *  server and client and React reports it as a hydration mismatch — the
 *  same reason note-view-model.ts formats dates from explicit UTC parts. */
const CAP = new Intl.NumberFormat("en-US");

export function ChatPanel({
  noteId,
  personaLabel,
  history,
  segments,
  activeSegmentId,
  onCitationSelect,
}: {
  noteId: string;
  personaLabel: string;
  history: ChatTurn[];
  segments: { id: number; time: string }[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<ChatScope>("this_note");

  // Scope is read through a ref, not closed over, so the transport below can
  // be built ONCE. Putting scope in the memo's deps would rebuild the
  // transport every time the toggle moves, and building it in the render body
  // — which is what this replaced — allocated a fresh one on every streamed
  // token.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // The server takes the newest message and the scope and nothing
        // else. History is re-read from the database, so a forged client
        // payload cannot walk past the trim.
        prepareSendMessagesRequest: ({ messages: sent }) => ({
          body: {
            noteId,
            scope: scopeRef.current,
            text:
              sent.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
          },
        }),
      }),
    [noteId],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const busy = status === "submitted" || status === "streaming";
  const tooLong = draft.length > MAX_MESSAGE_CHARS;
  const canSubmit = draft.trim().length > 0 && !tooLong && !busy;

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      sendMessage({ text: draft });
      setDraft("");
    },
    [canSubmit, draft, sendMessage],
  );

  // The list is a short scroll box. Without this, a streamed answer lands
  // below the fold after two turns and the reader watches a blank panel.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [history.length, messages]);

  const searching = messages
    .at(-1)
    ?.parts.some(
      (p) => p.type === "tool-searchNotes" && p.state !== "output-available",
    );

  return (
    <div className="border-t border-rule bg-dock px-[26px] pt-3 pb-3.5">
      <div
        ref={listRef}
        className="scroll-thin max-h-[220px] touch-manipulation overflow-y-auto overscroll-contain"
      >
        {/* Persisted turns first, then anything streaming in this session. */}
        {history.map((turn) => (
          <ChatMessage
            key={turn.id}
            role={turn.role}
            content={turn.content}
            citations={turn.citations}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onCitationSelect={onCitationSelect}
          />
        ))}

        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role === "user" ? "user" : "assistant"}
            content={message.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("")}
            citations={liveCitations(
              message.parts as { type: string; [k: string]: unknown }[],
            )}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onCitationSelect={onCitationSelect}
            // The last message is still arriving while the run is live. Its
            // markers are a prefix, not a failure.
            settled={!busy || message.id !== messages.at(-1)?.id}
          />
        ))}

        {/* Always mounted. A live region created at the same instant as its
            content is frequently not announced at all — the element has to
            already be in the tree when the text changes. Empty renders as
            nothing, so there is no visual cost to keeping it. */}
        <p
          aria-live="polite"
          className="font-mono text-[9px] uppercase tracking-[0.06em] text-meta empty:hidden pb-2"
        >
          {searching ? "Searching your notes…" : ""}
        </p>

        {/* A pipeline failure, NOT an empty search. An empty search is a
            normal answer and arrives as ordinary prose. */}
        {error ? (
          <p
            role="alert"
            className="mb-2 bg-notice-bg px-[9px] py-[7px] text-[11.5px] text-notice"
          >
            Something went wrong answering that. Try again.
          </p>
        ) : null}
      </div>

      <form
        onSubmit={submit}
        className="mt-[11px] flex items-center gap-[9px] border border-rule bg-paper px-2.5 py-2 focus-within:border-accent"
      >
        <input
          type="text"
          name="note-question"
          autoComplete="off"
          enterKeyHint="send"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={scope === "this_note" ? "Ask this note" : "Ask all notes"}
          aria-invalid={tooLong}
          placeholder={
            scope === "this_note" ? "Ask this note…" : "Ask all notes…"
          }
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
        />
        <ScopeToggle value={scope} disabled={busy} onChange={setScope} />
        <span className="flex-none font-mono text-[9px] uppercase tracking-[0.06em] text-accent">
          {personaLabel}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-none touch-manipulation font-mono text-[9px] uppercase tracking-[0.06em] text-accent-pressed disabled:cursor-not-allowed disabled:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          Ask
        </button>
      </form>

      {tooLong ? (
        <p role="alert" className="pt-1 font-mono text-[9px] text-notice">
          Too long — keep it under {CAP.format(MAX_MESSAGE_CHARS)} characters.
        </p>
      ) : null}
    </div>
  );
}
