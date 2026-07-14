import { describe, expect, it } from "vitest";
import { exportPlan, sharePlan, EXPORT_FORMATS } from "./export-model";

describe("exportPlan", () => {
  it("builds a filename from session id and format extension", () => {
    for (const format of EXPORT_FORMATS) {
      const plan = exportPlan("sess-42", format, false);
      expect(plan.filename).toBe(`sess-42.${format}`);
      expect(plan.format).toBe(format);
      expect(plan.filterName.length).toBeGreaterThan(0);
    }
  });

  it("preserves the caller's redact choice", () => {
    expect(exportPlan("s", "md", true).redact).toBe(true);
    expect(exportPlan("s", "md", false).redact).toBe(false);
  });
});

describe("sharePlan", () => {
  it("always forces redacted HTML", () => {
    const plan = sharePlan("sess-42");
    expect(plan.format).toBe("html");
    expect(plan.redact).toBe(true);
    expect(plan.filename).toBe("sess-42.html");
  });
});
