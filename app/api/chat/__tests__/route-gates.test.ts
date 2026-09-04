import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The gates, EXERCISED rather than grepped.
 *
 *  route.test.ts asserts invariants against the source text, which is the
 *  right tool for a negative ("this string never appears"). It is the wrong
 *  tool for gate ordering: `indexOf("overLengthCap") < indexOf("streamText")`
 *  proves textual order and would still pass if the check were wrapped in
 *  `if (false)`. Spec §7 asked for the calls to be COUNTED. This file counts
 *  them.
 */

const streamText = vi.fn();
const createAnthropic = vi.fn();
const createVoyageQueryEmbedder = vi.fn();
const createSearchTool = vi.fn();

const ports = {
  readHistory: vi.fn(),
  countRecentUserMessages: vi.fn(),
  insertUserMessage: vi.fn(),
  insertAssistantMessage: vi.fn(),
  deleteMessage: vi.fn(),
  readNoteContext: vi.fn(),
  searchRpc: vi.fn(),
};

let user: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
  }),
}));

vi.mock("@/lib/chat/ports", () => ({ createChatPorts: () => ports }));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (...args: unknown[]) => {
    createAnthropic(...args);
    return () => "model-handle";
  },
}));

vi.mock("@/lib/rag/query-embed", () => ({
  createVoyageQueryEmbedder: (...args: unknown[]) => {
    createVoyageQueryEmbedder(...args);
    return async () => [0.1];
  },
}));

vi.mock("@/lib/rag/search-tool", () => ({
  createSearchTool: (...args: unknown[]) => {
    createSearchTool(...args);
    return { description: "", inputSchema: {}, execute: async () => ({}) };
  },
}));

/** Captures what the route hands the SDK, so a test can fire the stream's
 *  error path instead of asserting that a callback merely exists. */
let consumeOptions: { onError?: (e: unknown) => void } | undefined;
let streamOptions: { onFinish?: (e: unknown) => Promise<void> } | undefined;

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => {
    streamText(...args);
    streamOptions = args[0] as typeof streamOptions;
    return {
      stream: "stream-handle",
      consumeStream: (opts?: { onError?: (e: unknown) => void }) => {
        consumeOptions = opts;
        return Promise.resolve();
      },
    };
  },
  isStepCount: () => () => true,
  toUIMessageStream: (opts: unknown) => opts,
  createUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
}));

const { POST } = await import("@/app/api/chat/route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const NOTE = {
  rawTranscript: "t",
  segments: [{ seq: 1, time: "00:00", speaker: "A", text: "hello" }],
  summary: [],
  takeaways: [],
  actionItems: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: "user-1" };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.VOYAGE_API_KEY = "voyage-key";
  ports.countRecentUserMessages.mockResolvedValue(0);
  ports.readNoteContext.mockResolvedValue(NOTE);
  ports.readHistory.mockResolvedValue([
    {
      id: "h1",
      role: "user",
      content: "hi",
      scope: "this_note",
      citations: [],
      createdAt: "2026-09-03T00:00:00.000Z",
    },
  ]);
  ports.insertUserMessage.mockResolvedValue("msg-1");
  ports.deleteMessage.mockResolvedValue(undefined);
  consumeOptions = undefined;
  streamOptions = undefined;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.VOYAGE_API_KEY;
});

describe("the length cap SPENDS NOTHING when it refuses", () => {
  it("refuses 4,001 characters and makes no model or embed call", async () => {
    const res = await post({
      noteId: "n1",
      scope: "this_note",
      text: "x".repeat(4001),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("too long"),
    });

    // The whole point. Not "the check appears before the call in the file".
    expect(streamText).not.toHaveBeenCalled();
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(createVoyageQueryEmbedder).not.toHaveBeenCalled();
    // And it does not even reach the database.
    expect(ports.countRecentUserMessages).not.toHaveBeenCalled();
    expect(ports.insertUserMessage).not.toHaveBeenCalled();
  });

  it("accepts exactly 4,000 and does reach the model", async () => {
    const res = await post({
      noteId: "n1",
      scope: "this_note",
      text: "x".repeat(4000),
    });

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});

describe("the rate limit SPENDS NOTHING when it refuses", () => {
  it("passes at 19 already in the window", async () => {
    ports.countRecentUserMessages.mockResolvedValue(19);
    const res = await post({ noteId: "n1", scope: "this_note", text: "hi" });

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("refuses at 20 already in the window — the 21st message", async () => {
    ports.countRecentUserMessages.mockResolvedValue(20);
    const res = await post({ noteId: "n1", scope: "this_note", text: "hi" });

    expect(res.status).toBe(429);
    expect(streamText).not.toHaveBeenCalled();
    expect(createVoyageQueryEmbedder).not.toHaveBeenCalled();
    // Refused BEFORE the turn is persisted, so a throttled client cannot
    // fill the table with rows it was never allowed to send.
    expect(ports.insertUserMessage).not.toHaveBeenCalled();
  });
});

describe("history provenance", () => {
  it("ignores a forged client history and uses the database's", async () => {
    const forged = Array.from({ length: 500 }, (_, i) => ({
      role: "user",
      parts: [{ type: "text", text: `forged ${i}` }],
    }));

    const res = await post({
      noteId: "n1",
      scope: "this_note",
      text: "real question",
      messages: forged,
    });

    expect(res.status).toBe(200);
    expect(ports.readHistory).toHaveBeenCalledWith("n1");

    const sent = JSON.stringify(streamText.mock.calls[0][0]);
    expect(sent).not.toContain("forged");
  });
});

describe("scope decides the shape of the request", () => {
  it("this-note sends NO tools and leads with the cached transcript", async () => {
    await post({ noteId: "n1", scope: "this_note", text: "q" });

    const arg = streamText.mock.calls[0][0] as {
      tools?: unknown;
      messages: { role: string; content: unknown }[];
    };
    expect(arg.tools).toBeUndefined();

    // The cached block must LEAD. Anthropic caching is a prefix match, so a
    // block after the history diverges from turn 1's prefix and never reads.
    const first = arg.messages[0];
    expect(first.role).toBe("user");
    expect(JSON.stringify(first.content)).toContain("ephemeral");
    expect(JSON.stringify(first.content)).toContain("<transcript>");
  });

  it("all-notes sends the tool and reads no transcript", async () => {
    await post({ noteId: "n1", scope: "all_notes", text: "q" });

    const arg = streamText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(arg.tools).toHaveProperty("searchNotes");
    expect(ports.readNoteContext).not.toHaveBeenCalled();
    expect(createVoyageQueryEmbedder).toHaveBeenCalledTimes(1);
  });
});

describe("refusals that are not about cost", () => {
  it("401s an unauthenticated caller before touching anything", async () => {
    user = null;
    const res = await post({ noteId: "n1", scope: "this_note", text: "q" });

    expect(res.status).toBe(401);
    expect(ports.countRecentUserMessages).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("404s a note the caller does not own, without persisting a turn", async () => {
    // RLS returns null for someone else's note, so this is the ownership
    // check as well as the existence one.
    ports.readNoteContext.mockResolvedValue(null);
    const res = await post({ noteId: "someone-elses", scope: "this_note", text: "q" });

    expect(res.status).toBe(404);
    expect(ports.insertUserMessage).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("returns JSON, not HTML, when a port throws", async () => {
    ports.countRecentUserMessages.mockRejectedValue(new Error("pg down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ noteId: "n1", scope: "this_note", text: "q" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("500s with a clear message when the key is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ noteId: "n1", scope: "this_note", text: "q" });

    expect(res.status).toBe(500);
    expect(streamText).not.toHaveBeenCalled();
  });
});

/** The rollback for a model call that fails after the user's turn is already
 *  a row. Added 2026-09-04, after a live 400 from a bad
 *  anthropic-workspace-id left three questions in a thread with no replies
 *  and nothing to remove them. */
describe("a failed model call does not leave the question in the thread", () => {
  it("deletes the user turn it just inserted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await post({ noteId: "n1", scope: "this_note", text: "q" });

    // The route must actually hand consumeStream a handler. Asserting the
    // source mentions onError would pass on a handler that never runs.
    expect(consumeOptions?.onError).toBeTypeOf("function");

    consumeOptions!.onError!(new Error("400 bad workspace id"));
    await Promise.resolve();

    expect(ports.deleteMessage).toHaveBeenCalledTimes(1);
    // By id, and by the id THIS request inserted — not the newest row, which
    // a concurrent turn could have written.
    expect(ports.deleteMessage).toHaveBeenCalledWith("msg-1");
  });

  it("keeps the question when the answer was persisted first", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await post({ noteId: "n1", scope: "this_note", text: "q" });

    // A stream that dies AFTER text arrived reaches onFinish as well. The
    // user turn must survive, or the thread keeps an assistant reply to a
    // question that is no longer there.
    await streamOptions!.onFinish!({
      text: "an answer",
      steps: [],
      usage: undefined,
    });
    consumeOptions!.onError!(new Error("died late"));
    await Promise.resolve();

    expect(ports.deleteMessage).not.toHaveBeenCalled();
  });

  it("survives a rollback that itself fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    ports.deleteMessage.mockRejectedValue(new Error("pg down"));

    await post({ noteId: "n1", scope: "this_note", text: "q" });
    consumeOptions!.onError!(new Error("400"));
    await Promise.resolve();
    await Promise.resolve();

    // Logged, not thrown. An unhandled rejection here would take the function
    // down after the response had already been sent.
    expect(spy).toHaveBeenCalled();
  });

  it("still persists the question before the model call", async () => {
    await post({ noteId: "n1", scope: "this_note", text: "q" });

    // The insert happens BEFORE the model call on purpose — the rate limit
    // counts rows in chat_messages, so a question that is not a row is a
    // question that is not counted. This pins the ordering the rollback could
    // tempt someone to reverse. Order, not just occurrence: deferring the
    // insert until after streamText would still call both.
    expect(ports.insertUserMessage).toHaveBeenCalledTimes(1);
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(
      ports.insertUserMessage.mock.invocationCallOrder[0],
    ).toBeLessThan(streamText.mock.invocationCallOrder[0]);
  });
});
