import { describe, expect, it } from "vitest";
import {
  countMatches,
  emailDomain,
  evaluateRule,
  evaluateRules,
  normalizeConditionValue,
  RULE_WINDOW_DAYS,
  type CollectionRule,
  type EvaluatableNote,
} from "@/lib/collection-rules/rule-engine";

/** A note with nothing on it, so each test states only what it is about. */
const note = (over: Partial<EvaluatableNote> = {}): EvaluatableNote => ({
  id: "note-1",
  title: null,
  attendeeEmails: null,
  ...over,
});

const rule = (
  conditions: CollectionRule["conditions"],
  id = "rule-1",
): CollectionRule => ({ id, collectionId: "col-1", conditions });

describe("normalizeConditionValue", () => {
  it("reads a domain out of all three shapes a person types", () => {
    // Copying a whole address out of an invite is the obvious way to build
    // this rule, so all three have to land on the same stored value.
    for (const raw of ["acme.com", "@acme.com", "Someone@Acme.com"]) {
      expect(normalizeConditionValue("attendee_email_domain", raw)).toBe(
        "acme.com",
      );
    }
  });

  it("rejects a domain with no dot", () => {
    // Without this, a typo'd "acme" is stored as a rule that can never match
    // and reads as broken rather than as rejected.
    expect(normalizeConditionValue("attendee_email_domain", "acme")).toBeNull();
    expect(normalizeConditionValue("attendee_email_domain", "@")).toBeNull();
  });

  it("lower-cases a keyword and collapses its whitespace", () => {
    expect(normalizeConditionValue("title_keyword", "  Q3   Planning ")).toBe(
      "q3 planning",
    );
  });

  it("returns null for anything that normalises to nothing", () => {
    expect(normalizeConditionValue("title_keyword", "   ")).toBeNull();
  });
});

describe("emailDomain", () => {
  it("splits on the LAST @, not the first", () => {
    // A local part may legally carry a quoted "@"; the domain is always what
    // follows the final one.
    expect(emailDomain('"odd@name"@acme.com')).toBe("acme.com");
  });

  it("is null for a string with no domain half", () => {
    expect(emailDomain("not-an-address")).toBeNull();
  });
});

describe("an exact email-domain match files the note", () => {
  const domainRule = rule([
    { kind: "attendee_email_domain", value: "acme.com", position: 0 },
  ]);

  it("matches an attendee at that domain and auto-files", () => {
    const match = evaluateRule(
      domainRule,
      note({ attendeeEmails: ["dana@example.org", "sam@acme.com"] }),
    );

    expect(match).toEqual({
      ruleId: "rule-1",
      collectionId: "col-1",
      conditionKind: "attendee_email_domain",
      // THE STATED ASSUMPTION: a domain is exact, so it is evidence strong
      // enough to act on unattended. See DISPOSITION_BY_KIND.
      disposition: "filed",
    });
  });

  it("is EXACT, so a look-alike domain does not match", () => {
    // endsWith would fire here, and a near miss is exactly what would
    // undermine calling a domain match strong enough to auto-file.
    expect(
      evaluateRule(domainRule, note({ attendeeEmails: ["sam@notacme.com"] })),
    ).toBeNull();
  });

  it("does not match a note with no attendees at all", () => {
    expect(evaluateRule(domainRule, note())).toBeNull();
    expect(evaluateRule(domainRule, note({ attendeeEmails: [] }))).toBeNull();
  });
});

describe("a title keyword routes to review instead", () => {
  const keywordRule = rule([
    { kind: "title_keyword", value: "planning", position: 0 },
  ]);

  it("matches case-insensitively and asks for a human", () => {
    const match = evaluateRule(
      keywordRule,
      note({ title: "Q3 Planning offsite" }),
    );
    expect(match?.disposition).toBe("needs_review");
  });

  it("is the looser test the split is justified by", () => {
    // "no planning needed" is a real false positive, and it is why this kind
    // does not file itself.
    expect(
      evaluateRule(keywordRule, note({ title: "No planning needed" })),
    ).not.toBeNull();
  });

  it("does not match a note with no title yet", () => {
    expect(evaluateRule(keywordRule, note())).toBeNull();
  });
});

describe("clauses are OR'd, and the strongest one wins", () => {
  it("fires on the OR-WHEN clause when the WHEN clause misses", () => {
    const match = evaluateRule(
      rule([
        { kind: "title_keyword", value: "budget", position: 0 },
        { kind: "title_keyword", value: "planning", position: 1 },
      ]),
      note({ title: "Q3 planning offsite" }),
    );
    expect(match?.conditionKind).toBe("title_keyword");
  });

  it("files rather than queues when both kinds fire", () => {
    // Weaker evidence must not cancel stronger evidence, whatever order the
    // clauses were written in.
    const match = evaluateRule(
      rule([
        { kind: "title_keyword", value: "planning", position: 0 },
        { kind: "attendee_email_domain", value: "acme.com", position: 1 },
      ]),
      note({ title: "Q3 planning", attendeeEmails: ["sam@acme.com"] }),
    );
    expect(match?.disposition).toBe("filed");
    expect(match?.conditionKind).toBe("attendee_email_domain");
  });

  it("matches nothing when the rule has no conditions", () => {
    // Filing every note into an unfinished rule would be the worst possible
    // reading of "no conditions".
    expect(evaluateRule(rule([]), note({ title: "anything" }))).toBeNull();
  });
});

describe("evaluateRules", () => {
  it("lets two rules both fire, because collections are many-to-many", () => {
    const matches = evaluateRules(
      [
        rule(
          [{ kind: "attendee_email_domain", value: "acme.com", position: 0 }],
          "rule-a",
        ),
        rule([{ kind: "title_keyword", value: "planning", position: 0 }], "rule-b"),
      ],
      note({ title: "Q3 planning", attendeeEmails: ["sam@acme.com"] }),
    );

    expect(matches.map((m) => m.ruleId)).toEqual(["rule-a", "rule-b"]);
  });
});

describe("the trailing 30-day window", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it("excludes a match older than the window", () => {
    const counts = countMatches(
      [
        { disposition: "filed", matchedAt: daysAgo(1) },
        { disposition: "filed", matchedAt: daysAgo(29) },
        // Outside. This is the assertion the counters exist to make true.
        { disposition: "filed", matchedAt: daysAgo(31) },
        { disposition: "filed", matchedAt: daysAgo(400) },
      ],
      now,
    );

    expect(counts.matched).toBe(2);
  });

  it("counts a false positive as a match as well as a false positive", () => {
    // Hiding it from `matched` would make the false-positive count read as a
    // fraction of a denominator that excludes it.
    const counts = countMatches(
      [
        { disposition: "filed", matchedAt: daysAgo(2) },
        { disposition: "needs_review", matchedAt: daysAgo(3) },
        { disposition: "false_positive", matchedAt: daysAgo(4) },
      ],
      now,
    );

    expect(counts).toEqual({ matched: 3, neededReview: 1, falsePositives: 1 });
  });

  it("keeps a match exactly on the boundary", () => {
    const counts = countMatches(
      [{ disposition: "filed", matchedAt: daysAgo(RULE_WINDOW_DAYS) }],
      now,
    );
    expect(counts.matched).toBe(1);
  });

  it("is zero for a rule that has never fired", () => {
    expect(countMatches([], now)).toEqual({
      matched: 0,
      neededReview: 0,
      falsePositives: 0,
    });
  });
});
