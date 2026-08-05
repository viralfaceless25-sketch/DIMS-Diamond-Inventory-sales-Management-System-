'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncLoad<T> = {
  data: T;
  loading: boolean;
  /** Message from the most recent failed attempt, or null if it succeeded. */
  error: string | null;
  /** Re-runs the loader. Safe to wire straight to a Retry button. */
  reload: () => void;
};

/**
 * Runs a loader with latest-result-wins and unmount guards, and keeps the
 * failure visible instead of letting it look like an empty result.
 *
 * A page that only tracked `rows` and `loading` rendered "nothing matches"
 * after a failed load, which tells the user their data is gone when in fact
 * the request failed. Callers must render `error` ahead of any empty state.
 *
 * The previous data is deliberately kept on failure, so a failed background
 * refresh does not blank a list the user is reading.
 */
export function useAsyncLoad<T>(loader: () => Promise<T>, initial: T): AsyncLoad<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only the newest run may write. Without this, a slow early request can
  // land after a fast later one and overwrite it with stale rows.
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;
    let active = true;
    const current = () => active && run === runRef.current;

    setLoading(true);
    loader().then(
      (result) => {
        if (!current()) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!current()) return;
        setError(reason instanceof Error && reason.message ? reason.message : 'Something went wrong. Please try again.');
        setLoading(false);
      }
    );

    return () => { active = false; };
  }, [loader, attempt]);

  const reload = useCallback(() => { setAttempt((value) => value + 1); }, []);

  return { data, loading, error, reload };
}
