import { escapeHtml } from "./escape.ts";

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`missing variable: ${name}`);
    return escapeHtml(String(vars[name]));
  });
}
