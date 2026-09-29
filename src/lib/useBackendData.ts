import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from './backend';

// Loads data from the backend, reloads when deps change or the backend reports a
// change (e.g. another tab), and exposes a manual reload for after mutations.
export function useBackendData<T>(load: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const value = await loadRef.current();
    setData(value);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRef.current().then((value) => {
      if (!active) return;
      setData(value);
      setLoading(false);
    });
    const unsubscribe = backend.onChange(() => {
      if (active) reload();
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, reload };
}
