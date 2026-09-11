import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRulesToNote,
  type PersistableMatch,
  type RulePorts,
} from "@/lib/collection-rules/apply-rules";
import { createRulePorts } from "@/lib/collection-rules/rule-ports";
import type { CollectionRule } from "@/lib/collection-rules/rule-engine";

/** Ports that record rather than write. Every field is overridable so a test
 *  states only the part it is about. */
function fakePorts(over: Partial<RulePorts> = {}) {
  const recorded: PersistableMatch[] = [];
  const filed: { noteId: string; collectionId: string }[] = [];

  const ports: RulePorts = {
    readNote: async () => ({
      id: "note-1",
      title: "Q3 planning offsite",
      attendeeEmails: ["sam@acme.com"],
    }),
    readRules: async () => [],
    recordMatch: async (match) => {
      recorded.push(match);
      return "recorded";
    },
    fileNote: async (args) => {
      filed.push({ noteId: args.noteId, collectionId: args.collectionId });
      return "filed";
    },
    ...over,
  };

  return { ports, recorded, filed };
}

const domainRule: CollectionRule = {
  id: "rule-domain",
  collectionId: "col-acme",
  conditions: [{ kind: "attendee_email_domain", value: "acme.com", position: 0 }],
};

const keywordRule: CollectionRule = {
  id: "rule-keyword",
  collectionId: "col-planning",
  conditions: [{ kind: "title_keyword", value: "planning", position: 0 }],
};

describe("applyRulesToNote", () => {
  it("files the note on an exact email-domain match", async () => {
    const { ports, recorded, filed } = fakePorts({
      readRules: async () => [domainRule],
    });

    const result = await applyRulesToNote(ports, {
      noteId: "note-1",
      userId: "u1",
    });

    expect(result).toEqual({
      matched: 1,
      filed: 1,
      needsReview: 0,
      alreadySeen: 0,
    });
    expect(filed).toEqual([{ noteId: "note-1", collectionId: "col-acme" }]);
    expect(recorded[0].disposition).toBe("filed");
  });

  it("writes NO membership for a needs-review match", async () => {
    // That is what the review state means. A title keyword records the match
    // and stops; the note waits for a human.
    const { ports, recorded, filed } = fakePorts({
      readRules: async () => [keywordRule],
    });

    const result = await applyRulesToNote(ports, {
      noteId: "note-1",
      userId: "u1",
    });

    expect(result.needsReview).toBe(1);
    expect(result.filed).toBe(0);
    expect(filed).toEqual([]);
    expect(recorded[0].disposition).toBe("needs_review");
  });

  it("records the match BEFORE filing, so a second pass re-files nothing", async () => {
    // The order is the whole idempotence story. "already" is the database's
    // unique (rule_id, note_id) firing, and it must stop the membership write
    // — otherwise a note the user unfiled would come back every sweep.
    const { ports, filed } = fakePorts({
      readRules: async () => [domainRule],
      recordMatch: async () => "already",
    });

    const result = await applyRulesToNote(ports, {
      noteId: "note-1",
      userId: "u1",
    });

    expect(result.alreadySeen).toBe(1);
    expect(result.filed).toBe(0);
    expect(filed).toEqual([]);
  });

  it("costs one read and nothing else for a user with no rules", async () => {
    const readNote = vi.fn();
    const { ports } = fakePorts({ readRules: async () => [], readNote });

    await applyRulesToNote(ports, { noteId: "note-1", userId: "u1" });
    expect(readNote).not.toHaveBeenCalled();
  });

  it("files into both collections when two rules fire", async () => {
    const { ports, filed } = fakePorts({
      readRules: async () => [
        domainRule,
        { ...domainRule, id: "rule-two", collectionId: "col-two" },
      ],
    });

    await applyRulesToNote(ports, { noteId: "note-1", userId: "u1" });
    expect(filed.map((f) => f.collectionId)).toEqual(["col-acme", "col-two"]);
  });
});

/**
 * THE GUARANTEE, proved rather than promised.
 *
 * "Rules only file notes; they never edit, re-run or delete one" is the
 * load-bearing claim of this feature. It is checked here by handing the REAL
 * Supabase implementation a client that records every table and every verb it
 * is asked for, running a full pass, and asserting on the whole list — not by
 * reading the code and agreeing with it.
 */
describe("the write surface", () => {
  const calls: { table: string; verb: string; args: unknown[] }[] = [];

  /** A Supabase client double. Each chain records the table and the verb, then
   *  answers with whatever this table is supposed to return. */
  function recordingClient(): SupabaseClient {
    const answers: Record<string, unknown> = {
      notes: {
        data: {
          id: "note-1",
          title: "Q3 planning offsite",
          attendee_emails: ["sam@acme.com"],
        },
        error: null,
      },
      collection_rules: {
        data: [
          {
            id: "rule-domain",
            collection_id: "col-acme",
            collection_rule_conditions: [
              { kind: "attendee_email_domain", value: "acme.com", position: 0 },
            ],
          },
        ],
        error: null,
      },
      collection_rule_matches: { data: null, error: null },
      note_collections: { data: null, error: null },
    };

    return {
      from(table: string) {
        const answer = answers[table] ?? { data: null, error: null };
        const chain: Record<string, unknown> = {
          maybeSingle: async () => answer,
          single: async () => answer,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(answer).then(resolve),
        };
        for (const verb of [
          "select",
          "insert",
          "update",
          "upsert",
          "delete",
          "eq",
          "is",
          "in",
          "order",
          "limit",
          "gte",
        ]) {
          chain[verb] = (...args: unknown[]) => {
            calls.push({ table, verb, args });
            return chain;
          };
        }
        return chain;
      },
    } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    calls.length = 0;
  });

  it("never issues a write against notes or note_chunks", async () => {
    await applyRulesToNote(createRulePorts(recordingClient()), {
      noteId: "note-1",
      userId: "u1",
    });

    const writes = calls.filter((c) =>
      ["insert", "update", "upsert", "delete"].includes(c.verb),
    );

    // Two writes, and both of them are the two this feature is allowed.
    expect(writes.map((c) => `${c.table}.${c.verb}`)).toEqual([
      "collection_rule_matches.insert",
      "note_collections.upsert",
    ]);

    // Stated the other way round as well, because the assertion above would
    // still pass if a THIRD table appeared and the array were loosened later.
    expect(writes.some((c) => c.table === "notes")).toBe(false);
    expect(writes.some((c) => c.table === "note_chunks")).toBe(false);
  });

  it("never reads note_chunks at all, and reads notes narrowly", async () => {
    await applyRulesToNote(createRulePorts(recordingClient()), {
      noteId: "note-1",
      userId: "u1",
    });

    expect(calls.some((c) => c.table === "note_chunks")).toBe(false);
    expect(calls.filter((c) => c.table === "notes").map((c) => c.verb)).toEqual([
      "select",
      "eq",
      "eq",
    ]);

    // THE COLUMN LIST IS THE ENFORCEMENT. A rule may read a note's title and
    // its attendees. Widening this select is what a reviewer has to notice,
    // so it is pinned here rather than left to a comment.
    const notesSelect = calls.find(
      (c) => c.table === "notes" && c.verb === "select",
    );
    expect(notesSelect?.args[0]).toBe("id, title, attendee_emails");
  });

  it("filters on user_id, because the cron client bypasses RLS", async () => {
    // The standing exception CLAUDE.md names. service_role is not subject to
    // RLS, so an unfiltered read here would evaluate one account's note
    // against another account's rules and file it into their collection.
    await applyRulesToNote(createRulePorts(recordingClient()), {
      noteId: "note-1",
      userId: "u1",
    });

    const eqs = calls
      .filter((c) => c.verb === "eq")
      .map((c) => [c.table, ...c.args]);

    expect(eqs).toContainEqual(["collection_rules", "user_id", "u1"]);
    expect(eqs).toContainEqual(["notes", "user_id", "u1"]);
  });
});
