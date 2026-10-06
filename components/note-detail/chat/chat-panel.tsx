"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatScope, ChatTurn, Citation } from "@/lib/chat/types";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import { ChatMessage } from "./chat-message";
import { ScopeToggle } from "./scope-toggle";
import { DemoQuestionsLine, questionsLeftNow, refusalText } from "./demo-questions";

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
  demoQuestionsLeft = null,
}: {
  /** A demo visitor's remaining questions when the page was read, or null for
   *  a real account. The route is what enforces the cap; this only shows it. */
  demoQuestionsLeft?: number | null;
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
  const questionsLeft = questionsLeftNow(
    demoQuestionsLeft,
    messages.filter((m) => m.role === "user").length,
    error !== undefined,
  );
  const outOfQuestions = questionsLeft === 0;
  const canSubmit = draft.trim().length > 0 && !tooLong && !busy && !outOfQuestions;

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
    // Below 768px (issue #91) the composer is one line, the field and Ask,
    // until it holds focus: then the scope and the lens join it on a second
    // line. The answers above it stop at 18% of the screen, so a long
    // exchange never buries the note.
    <div className="group/chat border-t border-rule-strong bg-dock px-[26px] pt-3 pb-3.5 max-md:px-[16px] max-md:pt-[6px] max-md:pb-[6px]">
      <div
        ref={listRef}
        className="scroll-thin max-h-[220px] touch-manipulation overflow-y-auto overscroll-contain max-md:max-h-[18dvh]"
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
          className="font-mono text-[9px] uppercase tracking-[0.06em] text-meta empty:hidden pb-2 max-md:text-[11px]"
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
            {refusalText(error) ?? "Something went wrong answering that. Try again."}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={submit}
        className="mt-[11px] flex items-center gap-[9px] max-md:mt-0 max-md:flex-wrap max-md:gap-y-[7px] border border-control-edge bg-paper px-2.5 py-2 max-md:py-[5px] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent"
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
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder max-md:order-1 max-md:text-[16px]"
        />
        {/* One box for the scope and the lens, so below 768px they take a
            whole second line together (`basis-full`) rather than squeezing
            the field on the first. `contents` above it: unchanged there. */}
        <span className="contents max-md:order-3 max-md:hidden max-md:basis-full max-md:items-center max-md:gap-[9px] max-md:group-focus-within/chat:flex">
          <ScopeToggle value={scope} disabled={busy} onChange={setScope} />
          <span className="flex-none font-mono text-[9px] uppercase tracking-[0.06em] text-accent max-md:text-[11px]">
            {personaLabel}
          </span>
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          // A press on Ask keeps focus in the field, so the composer does not
          // fold to one line under the finger between press and release.
          onPointerDown={(e) => e.preventDefault()}
          className="flex-none touch-manipulation font-mono text-[9px] uppercase tracking-[0.06em] text-accent-pressed max-md:order-2 max-md:min-h-[32px] max-md:px-[6px] max-md:text-[11px] disabled:cursor-not-allowed disabled:text-ink-disabled focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          Ask
        </button>
      </form>

      {tooLong ? (
        <p role="alert" className="pt-1 font-mono text-[9px] text-notice max-md:text-[11px]">
          Too long — keep it under {CAP.format(MAX_MESSAGE_CHARS)} characters.
        </p>
      ) : null}

      {questionsLeft === null ? null : <DemoQuestionsLine left={questionsLeft} />}
    </div>
  );
}
