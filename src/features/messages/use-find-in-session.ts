import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/bindings";
import { extractMessageText } from "./message-text";

export interface FindInSession {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** Message indices containing the query, in document order. */
  matches: number[];
  /** Position within `matches` (0-based); -1 when there are none. */
  active: number;
  /** Message index of the active match; null when there are none. */
  activeMessageIndex: number | null;
  openBar: () => void;
  close: () => void;
  next: () => void;
  previous: () => void;
}

/**
 * Find-in-session over extracted plain text (not the DOM): virtualized
 * messages are unmounted while off-screen, so the DOM never holds the
 * full transcript.
 */
export function useFindInSession(messages: Message[] | undefined): FindInSession {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [active, setActive] = useState(0);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setActive(0);
  }, []);

  const texts = useMemo(
    () => (messages ?? []).map((m) => extractMessageText(m).toLowerCase()),
    [messages],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hits: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].includes(needle)) hits.push(i);
    }
    return hits;
  }, [texts, query]);

  const openBar = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, [setQuery]);
  const next = useCallback(() => {
    if (matches.length > 0) setActive((a) => (a + 1) % matches.length);
  }, [matches.length]);
  const previous = useCallback(() => {
    if (matches.length > 0) {
      setActive((a) => (a - 1 + matches.length) % matches.length);
    }
  }, [matches.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const clampedActive = matches.length > 0 ? Math.min(active, matches.length - 1) : -1;

  return {
    open,
    query,
    setQuery,
    matches,
    active: clampedActive,
    activeMessageIndex: clampedActive >= 0 ? matches[clampedActive] : null,
    openBar,
    close,
    next,
    previous,
  };
}
