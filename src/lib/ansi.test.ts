import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m plain`)).toBe("red plain");
    expect(stripAnsi(`${ESC}[1;32mbold green${ESC}[39;49m`)).toBe("bold green");
  });
  it("removes OSC hyperlinks but keeps the visible text", () => {
    expect(
      stripAnsi(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`),
    ).toBe("link");
  });
  it("leaves plain text untouched", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});
