import { describe, expect, it } from "vitest";
import {
  activeSlashToken,
  applyCompletion,
  filterCompletions,
  mergeCatalogs,
  type CompletionItem,
} from "./slash-completion";

describe("activeSlashToken", () => {
  it("matches a slash at the start of the text", () => {
    expect(activeSlashToken("/co", 3)).toEqual({ start: 0, query: "co" });
    expect(activeSlashToken("/", 1)).toEqual({ start: 0, query: "" });
  });

  it("matches a slash after whitespace, including newlines", () => {
    expect(activeSlashToken("run /coo", 8)).toEqual({ start: 4, query: "coo" });
    expect(activeSlashToken("first line\n/pl", 14)).toEqual({
      start: 11,
      query: "pl",
    });
  });

  it("uses the caret position, not the end of the text", () => {
    expect(activeSlashToken("/cook then more", 3)).toEqual({
      start: 0,
      query: "co",
    });
    // Caret past the token's trailing space: no longer inside it.
    expect(activeSlashToken("/cook then more", 6)).toBeNull();
  });

  it("ignores mid-word and path-like slashes", () => {
    expect(activeSlashToken("foo/bar", 7)).toBeNull();
    expect(activeSlashToken("see src/lib", 11)).toBeNull();
    expect(activeSlashToken("https://example.com", 19)).toBeNull();
  });

  it("returns null without a slash token", () => {
    expect(activeSlashToken("hello", 5)).toBeNull();
    expect(activeSlashToken("", 0)).toBeNull();
  });
});

describe("filterCompletions", () => {
  const items: CompletionItem[] = [
    { name: "cook", kind: "command" },
    { name: "code-reviewer", kind: "agent" },
    { name: "compact", kind: "command" },
    { name: "plan", kind: "command" },
  ];

  it("prefix-matches case-insensitively and keeps order", () => {
    expect(filterCompletions(items, "co").map((i) => i.name)).toEqual([
      "cook",
      "code-reviewer",
      "compact",
    ]);
    expect(filterCompletions(items, "CO").map((i) => i.name)).toEqual([
      "cook",
      "code-reviewer",
      "compact",
    ]);
  });

  it("empty query matches everything, no match yields empty", () => {
    expect(filterCompletions(items, "")).toHaveLength(4);
    expect(filterCompletions(items, "zzz")).toEqual([]);
  });
});

describe("applyCompletion", () => {
  it("replaces the token with the name plus a trailing space", () => {
    const result = applyCompletion(
      "/co",
      { start: 0, query: "co" },
      "cook",
    );
    expect(result).toEqual({ text: "/cook ", caret: 6 });
  });

  it("keeps surrounding text intact", () => {
    const result = applyCompletion(
      "run /pl please",
      { start: 4, query: "pl" },
      "plan",
    );
    expect(result).toEqual({ text: "run /plan  please", caret: 10 });
  });

  it("consumes the rest of the token when completing from mid-token", () => {
    const result = applyCompletion(
      "run /coo now",
      { start: 4, query: "co" },
      "cook",
    );
    expect(result).toEqual({ text: "run /cook  now", caret: 10 });
  });
});

describe("mergeCatalogs", () => {
  it("unions both sources, sorted by name", () => {
    const merged = mergeCatalogs(
      { commands: ["cook"], agents: ["debugger"] },
      { slashCommands: ["compact", "cook"], agents: ["code-reviewer"] },
    );
    expect(merged).toEqual([
      { name: "code-reviewer", kind: "agent" },
      { name: "compact", kind: "command" },
      { name: "cook", kind: "command" },
      { name: "debugger", kind: "agent" },
    ]);
  });

  it("agent kind wins when a name appears as both", () => {
    const merged = mergeCatalogs(
      { commands: ["helper"], agents: [] },
      { slashCommands: [], agents: ["helper"] },
    );
    expect(merged).toEqual([{ name: "helper", kind: "agent" }]);
  });

  it("tolerates missing sources", () => {
    expect(mergeCatalogs(undefined, null)).toEqual([]);
    expect(
      mergeCatalogs({ commands: ["cook"], agents: [] }, null),
    ).toEqual([{ name: "cook", kind: "command" }]);
  });
});
