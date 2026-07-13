import { useCallback, useState } from "react";

/** Persisted boolean/JSON state; falls back to the default on any error. */
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? defaultValue : (JSON.parse(stored) as T);
    } catch {
      return defaultValue;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Persistence is best-effort; in-memory state still updates.
      }
    },
    [key],
  );

  return [value, set] as const;
}
