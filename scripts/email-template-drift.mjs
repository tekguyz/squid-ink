/**
 * The comparison behind scripts/verify-email-templates.mjs.
 *
 * The hosted auth email templates are pasted into the Supabase dashboard by
 * hand (docs/DEPLOYMENT.md § Auth email). The repo copies are the
 * `[auth.email.template.*]` sections of supabase/config.toml and the HTML files
 * they point at. This module holds the pure half: read the repo side, compare
 * it with the management API's auth config. No network, no file system.
 */

const SECTION = /^\[auth\.email\.template\.(\w+)\]\s*$/gm;

/** @param {string} body @param {string} key */
function tomlString(body, key) {
  return body.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
}

/**
 * Every uncommented `[auth.email.template.<name>]` section. A commented one
 * starts with `#`, so the line-anchored pattern never sees it.
 * @param {string} toml
 * @param {(path: string) => string} readFile  given the content_path as written
 */
export function readRepoTemplates(toml, readFile) {
  const heads = [...toml.matchAll(SECTION)];
  return heads.map((head, i) => {
    const end = heads[i + 1]?.index ?? toml.length;
    const body = toml.slice(head.index + head[0].length, end).split(/^\[/m)[0];
    const path = tomlString(body, "content_path");
    return {
      name: head[1],
      subject: tomlString(body, "subject"),
      content: path === undefined ? undefined : readFile(path),
    };
  });
}

/** A Windows checkout may carry CRLF; the dashboard stores LF. */
const normalise = (/** @type {string | undefined} */ s) => s?.replace(/\r\n/g, "\n");

/**
 * @param {Record<string, unknown>} hosted  GET /v1/projects/{ref}/config/auth
 * @param {{ name: string, subject?: string, content?: string }[]} repo
 */
export function findTemplateDrift(hosted, repo) {
  const drift = [];
  for (const t of repo) {
    const fields = [
      ["subject", `mailer_subjects_${t.name}`, t.subject],
      ["content", `mailer_templates_${t.name}_content`, t.content],
    ];
    for (const [field, key, local] of fields) {
      const remote = /** @type {string | undefined} */ (hosted[key]);
      if (normalise(remote) !== normalise(local)) {
        drift.push({ name: t.name, field, key, hosted: remote, repo: local });
      }
    }
  }
  return drift;
}
