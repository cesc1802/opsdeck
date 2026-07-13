import { describe, expect, it } from "vitest";
import { formatCost, formatTokens, relativeTime, totalTokens } from "./format";

describe("formatTokens", () => {
  it("keeps small counts verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(56_789)).toBe("57k");
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });
});

describe("formatCost", () => {
  it("handles zero, sub-cent, and normal values", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(3.654)).toBe("$3.65");
  });
});

describe("totalTokens", () => {
  it("sums all four buckets", () => {
    expect(
      totalTokens({
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      }),
    ).toBe(10);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");
  it("buckets by age", () => {
    expect(relativeTime("2026-07-13T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-07-13T11:45:00Z", now)).toBe("15m ago");
    expect(relativeTime("2026-07-13T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-07-10T12:00:00Z", now)).toBe("3d ago");
  });
  it("is empty for missing or invalid timestamps", () => {
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});
