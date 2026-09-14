import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RulePanel } from "../rule-panel";
import { ReviewList } from "../review-list";
import type { CollectionRuleView } from "@/lib/collection-rules/read-rules";

/** The Server Actions, stubbed — this file is about what the panel SENDS.
 *  app/notes/actions/__tests__ owns what the actions do with it. */
const actions = vi.hoisted(() => ({
  addRuleCondition: vi.fn(async () => "written" as string),
  deleteRuleCondition: vi.fn(async () => "written" as const),
  confirmRuleMatch: vi.fn(async () => "written" as const),
  rejectRuleMatch: vi.fn(async () => "written" as const),
  markRuleMatchFalsePositive: vi.fn(async () => "written" as const),
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/app/notes/actions/collection-rules", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const rule: CollectionRuleView = {
  id: "r1",
  collectionId: "northwind-pilot",
  conditions: [
    { id: "c1", kind: "attendee_email_domain", value: "northwind.health", position: 0 },
    { id: "c2", kind: "title_keyword", value: "pilot", position: 1 },
  ],
  counters: { matched: 9, neededReview: 1, falsePositives: 0 },
};

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear();
  refresh.mockClear();
});

describe("RulePanel", () => {
  it("renders WHEN then OR WHEN, in the drawing's copy", () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("WHEN");
    expect(items[0]).toHaveTextContent("an attendee's email ends in @northwind.health");
    expect(items[1]).toHaveTextContent("OR WHEN");
    expect(items[1]).toHaveTextContent("the title contains pilot");
  });

  it("prints the three counts and the footer line verbatim", () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    expect(screen.getByText("9 notes")).toBeInTheDocument();
    expect(
      screen.getByText("Rules only file notes. They never edit, re-run, or delete a note."),
    ).toBeInTheDocument();
  });

  it("drills into the review view from the needed review count", () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    expect(screen.getByRole("link", { name: "needed review" })).toHaveAttribute(
      "href",
      "/collections/northwind-pilot/review",
    );
  });

  it("renders with no rule yet, so adding a condition is where one starts", () => {
    render(<RulePanel slug="northwind-pilot" rule={null} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("0 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ ADD CONDITION" })).toBeInTheDocument();
  });

  it("removes one condition by its id", async () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove condition: the title contains pilot" }),
    );
    expect(actions.deleteRuleCondition).toHaveBeenCalledWith("c2");
    expect(refresh).toHaveBeenCalled();
  });

  it("adds a condition of the chosen kind, immediately", async () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    await userEvent.click(screen.getByRole("button", { name: "+ ADD CONDITION" }));
    const form = screen.getByRole("form", { name: "Add condition" });
    await userEvent.click(within(form).getByRole("button", { name: "Email domain" }));
    await userEvent.type(within(form).getByRole("textbox"), "acme.com");
    await userEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(actions.addRuleCondition).toHaveBeenCalledWith(
      "northwind-pilot",
      "attendee_email_domain",
      "acme.com",
    );
  });

  it("submits on Enter, and closes on Escape without writing", async () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    await userEvent.click(screen.getByRole("button", { name: "+ ADD CONDITION" }));
    await userEvent.type(screen.getByRole("textbox"), "clinic{Enter}");
    expect(actions.addRuleCondition).toHaveBeenCalledWith(
      "northwind-pilot",
      "title_keyword",
      "clinic",
    );

    actions.addRuleCondition.mockClear();
    await userEvent.click(await screen.findByRole("button", { name: "+ ADD CONDITION" }));
    await userEvent.type(screen.getByRole("textbox"), "draft{Escape}");
    expect(screen.queryByRole("form", { name: "Add condition" })).toBeNull();
    expect(actions.addRuleCondition).not.toHaveBeenCalled();
  });

  it("keeps the form open and says why when the value is invalid", async () => {
    actions.addRuleCondition.mockResolvedValueOnce("invalid");
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    await userEvent.click(screen.getByRole("button", { name: "+ ADD CONDITION" }));
    await userEvent.click(screen.getByRole("button", { name: "Email domain" }));
    await userEvent.type(screen.getByRole("textbox"), "acme");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("A domain needs a dot, like acme.com.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no promote-to-auto-file control", () => {
    render(<RulePanel slug="northwind-pilot" rule={rule} />);
    expect(screen.queryByRole("button", { name: /promote|auto-file/i })).toBeNull();
  });
});

describe("ReviewList", () => {
  const match = {
    id: "m1",
    noteId: "note-1",
    noteTitle: "Pilot pricing & rollout",
    conditionKind: "title_keyword" as const,
    matchedOn: "26 AUG",
  };

  it("confirms and rejects by match id", async () => {
    render(<ReviewList collectionName="Northwind pilot" matches={[match]} />);
    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    expect(actions.confirmRuleMatch).toHaveBeenCalledWith("m1");
    await userEvent.click(screen.getByRole("button", { name: /^Reject/ }));
    expect(actions.rejectRuleMatch).toHaveBeenCalledWith("m1");
    // Reject is the needs-review door, never the filed-match one.
    expect(actions.markRuleMatchFalsePositive).not.toHaveBeenCalled();
  });

  it("links the note and says what the rule matched on", () => {
    render(<ReviewList collectionName="Northwind pilot" matches={[match]} />);
    expect(screen.getByRole("link", { name: "Pilot pricing & rollout" })).toHaveAttribute(
      "href",
      "/notes/note-1",
    );
    expect(screen.getByText("matched on title keyword")).toBeInTheDocument();
  });

  it("says so when nothing is waiting", () => {
    render(<ReviewList collectionName="Northwind pilot" matches={[]} />);
    expect(screen.getByText("Nothing waiting for review")).toBeInTheDocument();
  });
});
