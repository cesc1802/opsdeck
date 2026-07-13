import { describe, expect, it } from "vitest";
import type { SessionMeta } from "@/lib/bindings";
import { matchesFilter } from "./session-filters";

function session(partial: Partial<SessionMeta>): SessionMeta {
  return {
    id: "s1",
    project_id: "p1",
    name: "test",
    is_active: false,
    started_at: "2026-07-13T10:00:00Z",
    ended_at: null,
    message_count: 0,
    ...partial,
  };
}

describe("matchesFilter", () => {
  // Use a specific timestamp that represents local date boundaries.
  // The implementation uses Date.getDate() which is timezone-aware,
  // so we test with times that represent clear calendar boundaries.
  const now = Date.parse("2026-07-13T12:00:00Z");
  const yesterday = "2026-07-12T10:00:00Z";
  const today = "2026-07-13T10:00:00Z";
  const tomorrow = "2026-07-14T10:00:00Z";

  describe("all filter", () => {
    it("matches any session", () => {
      expect(matchesFilter(session({}), "all", now)).toBe(true);
      expect(
        matchesFilter(
          session({ started_at: "2020-01-01T00:00:00Z" }),
          "all",
          now,
        ),
      ).toBe(true);
      expect(
        matchesFilter(session({ is_active: true }), "all", now),
      ).toBe(true);
    });
  });

  describe("running filter", () => {
    it("matches only active sessions", () => {
      expect(
        matchesFilter(session({ is_active: true }), "running", now),
      ).toBe(true);
      expect(
        matchesFilter(session({ is_active: false }), "running", now),
      ).toBe(false);
    });
  });

  describe("today filter", () => {
    it("matches sessions active today", () => {
      expect(
        matchesFilter(
          session({ started_at: today }),
          "today",
          now,
        ),
      ).toBe(true);
    });

    it("matches sessions ending today", () => {
      expect(
        matchesFilter(
          session({
            started_at: yesterday,
            ended_at: today,
          }),
          "today",
          now,
        ),
      ).toBe(true);
    });

    it("does not match sessions from yesterday", () => {
      expect(
        matchesFilter(
          session({ started_at: yesterday }),
          "today",
          now,
        ),
      ).toBe(false);
    });

    it("does not match sessions from tomorrow", () => {
      expect(
        matchesFilter(
          session({ started_at: tomorrow }),
          "today",
          now,
        ),
      ).toBe(false);
    });

    it("prioritizes ended_at over started_at", () => {
      expect(
        matchesFilter(
          session({
            started_at: "2026-07-12T00:00:00Z",
            ended_at: "2026-07-13T15:00:00Z",
          }),
          "today",
          now,
        ),
      ).toBe(true);
    });

    it("handles null dates gracefully", () => {
      expect(
        matchesFilter(
          session({
            started_at: null,
            ended_at: null,
          }),
          "today",
          now,
        ),
      ).toBe(false);
    });

    it("handles invalid ISO strings gracefully", () => {
      expect(
        matchesFilter(
          session({ started_at: "not-a-date" }),
          "today",
          now,
        ),
      ).toBe(false);
    });
  });

  describe("7d filter", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it("matches sessions within 7 days", () => {
      expect(
        matchesFilter(
          session({ started_at: "2026-07-13T11:59:00Z" }),
          "7d",
          now,
        ),
      ).toBe(true);
      expect(
        matchesFilter(
          session({ started_at: "2026-07-06T12:00:01Z" }),
          "7d",
          now,
        ),
      ).toBe(true);
    });

    it("does not match sessions older than 7 days", () => {
      expect(
        matchesFilter(
          session({ started_at: "2026-07-06T11:59:00Z" }),
          "7d",
          now,
        ),
      ).toBe(false);
    });

    it("respects exact 7-day boundary", () => {
      const exactly7DaysAgo = now - 7 * DAY_MS;
      expect(
        matchesFilter(
          session({ started_at: new Date(exactly7DaysAgo).toISOString() }),
          "7d",
          now,
        ),
      ).toBe(true);

      const justOver7Days = now - 7 * DAY_MS - 1;
      expect(
        matchesFilter(
          session({ started_at: new Date(justOver7Days).toISOString() }),
          "7d",
          now,
        ),
      ).toBe(false);
    });

    it("prioritizes ended_at for boundary calculations", () => {
      const exactly7DaysAgo = now - 7 * DAY_MS;
      expect(
        matchesFilter(
          session({
            started_at: "2026-01-01T00:00:00Z",
            ended_at: new Date(exactly7DaysAgo).toISOString(),
          }),
          "7d",
          now,
        ),
      ).toBe(true);
    });

    it("handles null dates gracefully", () => {
      expect(
        matchesFilter(
          session({
            started_at: null,
            ended_at: null,
          }),
          "7d",
          now,
        ),
      ).toBe(false);
    });
  });

  describe("30d filter", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it("matches sessions within 30 days", () => {
      expect(
        matchesFilter(
          session({ started_at: "2026-07-13T11:59:00Z" }),
          "30d",
          now,
        ),
      ).toBe(true);
      expect(
        matchesFilter(
          session({ started_at: "2026-06-13T12:00:01Z" }),
          "30d",
          now,
        ),
      ).toBe(true);
    });

    it("does not match sessions older than 30 days", () => {
      expect(
        matchesFilter(
          session({ started_at: "2026-06-13T11:59:00Z" }),
          "30d",
          now,
        ),
      ).toBe(false);
    });

    it("respects exact 30-day boundary", () => {
      const exactly30DaysAgo = now - 30 * DAY_MS;
      expect(
        matchesFilter(
          session({ started_at: new Date(exactly30DaysAgo).toISOString() }),
          "30d",
          now,
        ),
      ).toBe(true);

      const justOver30Days = now - 30 * DAY_MS - 1;
      expect(
        matchesFilter(
          session({ started_at: new Date(justOver30Days).toISOString() }),
          "30d",
          now,
        ),
      ).toBe(false);
    });
  });
});
