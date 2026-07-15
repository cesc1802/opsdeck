// Pure logic for the composer's /slash completion popup: token detection at
// the caret, prefix filtering, plain-text insertion, and merging the two data
// sources (filesystem scan + session init lists).
import type { CompletionCatalog } from "@/lib/bindings";

export interface CompletionItem {
  name: string;
  kind: "command" | "agent";
}

/** A `/token` under the caret: `start` indexes the `/` in the full text. */
export interface SlashToken {
  start: number;
  query: string;
}

/**
 * The slash token the caret is inside, or null. A token only counts when its
 * `/` sits at the start of the text or right after whitespace — `foo/bar`
 * and mid-word slashes never trigger — and the query itself contains no
 * further `/` (path-like input) and no whitespace (token already left).
 */
export function activeSlashToken(
  text: string,
  caret: number,
): SlashToken | null {
  const upToCaret = text.slice(0, caret);
  const start = Math.max(
    upToCaret.lastIndexOf(" "),
    upToCaret.lastIndexOf("\n"),
    upToCaret.lastIndexOf("\t"),
  ) + 1;
  const token = upToCaret.slice(start);
  if (!token.startsWith("/")) return null;
  const query = token.slice(1);
  if (query.includes("/")) return null;
  return { start, query };
}

/** Case-insensitive prefix match, preserving the input order. */
export function filterCompletions(
  items: CompletionItem[],
  query: string,
): CompletionItem[] {
  const q = query.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().startsWith(q));
}

/**
 * Replace the token with `/name ` (trailing space so typing continues
 * naturally) and return the new text plus where the caret belongs. The whole
 * token is consumed, including any part after the caret, so completing from
 * mid-token leaves no residue (`/co|o` → `/cook `, not `/cook o`).
 */
export function applyCompletion(
  text: string,
  token: SlashToken,
  name: string,
): { text: string; caret: number } {
  let end = token.start + 1 + token.query.length;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const inserted = `/${name} `;
  return {
    text: text.slice(0, token.start) + inserted + text.slice(end),
    caret: token.start + inserted.length,
  };
}

/**
 * Union the filesystem scan with the session init lists (either may be
 * missing). A name listed as both command and agent keeps the agent kind —
 * agents are the more specific affordance. Sorted by name.
 */
export function mergeCatalogs(
  scan: CompletionCatalog | undefined,
  init: { slashCommands: string[]; agents: string[] } | null,
): CompletionItem[] {
  const kinds = new Map<string, "command" | "agent">();
  for (const name of [...(scan?.commands ?? []), ...(init?.slashCommands ?? [])]) {
    kinds.set(name, "command");
  }
  for (const name of [...(scan?.agents ?? []), ...(init?.agents ?? [])]) {
    kinds.set(name, "agent");
  }
  return [...kinds.entries()]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
