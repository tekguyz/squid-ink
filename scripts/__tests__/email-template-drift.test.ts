import { describe, expect, it } from "vitest";
import { findTemplateDrift, readRepoTemplates } from "../email-template-drift.mjs";

const TOML = `
[auth.email.template.confirmation]
subject = "Confirm your account"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your password"
content_path = "./supabase/templates/recovery.html"

# [auth.email.template.invite]
# subject = "You have been invited"
# content_path = "./supabase/templates/invite.html"
`;

const FILES: Record<string, string> = {
  "./supabase/templates/confirmation.html": "<p>confirm</p>\n",
  "./supabase/templates/recovery.html": "<p>recover</p>\n",
};

const repo = readRepoTemplates(TOML, (path: string) => FILES[path]);

const hosted = {
  mailer_subjects_confirmation: "Confirm your account",
  mailer_templates_confirmation_content: "<p>confirm</p>\n",
  mailer_subjects_recovery: "Reset your password",
  mailer_templates_recovery_content: "<p>recover</p>\n",
};

describe("readRepoTemplates", () => {
  it("reads every uncommented template section, and no commented one", () => {
    expect(repo).toEqual([
      { name: "confirmation", subject: "Confirm your account", content: "<p>confirm</p>\n" },
      { name: "recovery", subject: "Reset your password", content: "<p>recover</p>\n" },
    ]);
  });
});

describe("findTemplateDrift", () => {
  it("finds nothing when hosted matches the repo", () => {
    expect(findTemplateDrift(hosted, repo)).toEqual([]);
  });

  it("ignores CRLF line endings from a Windows checkout", () => {
    const crlf = repo.map((t) => ({ ...t, content: t.content?.replace(/\n/g, "\r\n") }));
    expect(findTemplateDrift(hosted, crlf)).toEqual([]);
  });

  it("reports a changed body, naming the template and the field", () => {
    const edited = { ...hosted, mailer_templates_recovery_content: "<p>edited</p>\n" };
    expect(findTemplateDrift(edited, repo)).toEqual([
      expect.objectContaining({ name: "recovery", field: "content" }),
    ]);
  });

  it("reports a changed subject", () => {
    const edited = { ...hosted, mailer_subjects_confirmation: "Your code" };
    expect(findTemplateDrift(edited, repo)).toEqual([
      expect.objectContaining({ name: "confirmation", field: "subject", hosted: "Your code" }),
    ]);
  });

  it("reports a template the hosted config does not carry", () => {
    const { mailer_templates_recovery_content: _, ...missing } = hosted;
    expect(findTemplateDrift(missing, repo)).toEqual([
      expect.objectContaining({ name: "recovery", field: "content", hosted: undefined }),
    ]);
  });
});
