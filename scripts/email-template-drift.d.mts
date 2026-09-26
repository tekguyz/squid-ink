export interface RepoTemplate {
  name: string;
  subject?: string;
  content?: string;
}
export interface TemplateDrift {
  name: string;
  field: "subject" | "content";
  key: string;
  hosted: string | undefined;
  repo: string | undefined;
}
export function readRepoTemplates(toml: string, readFile: (path: string) => string): RepoTemplate[];
export function findTemplateDrift(hosted: Record<string, unknown>, repo: RepoTemplate[]): TemplateDrift[];
