import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;

// Fetches immediately, then every POLL_MS while the tab is visible. Keeps the last good data on errors.
export function usePoll(fetcher, deps, { enabled = true, interval = POLL_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const gen = generation.current;
    try {
      const data = await fetcherRef.current();
      if (gen === generation.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (gen === generation.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    generation.current++;
    setState({ data: null, error: null, loading: true });
    if (!enabled) return undefined;
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, interval);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { ...state, refresh };
}
