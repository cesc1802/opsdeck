import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("i18n", () => {
  it("resolves known keys to non-empty English strings", () => {
    expect(t("app.name")).toBe("OpsDeck");
    expect(t("shell.main.placeholder").length).toBeGreaterThan(0);
  });
});
