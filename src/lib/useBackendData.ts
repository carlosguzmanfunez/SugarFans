import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import { sharedRequest } from './sharedRequest';

// Loads data from the backend, reloads when deps change or the backend reports a
// change (e.g. another tab), and exposes a manual reload for after mutations.
// With a shareKey, screens open at the same time that load the same thing (same
// key, same result) share one request (see sharedRequest).
export function useBackendData<T>(load: () => Promise<T>, deps: unknown[], initial: T, shareKey?: string) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const keyRef = useRef(shareKey);
  keyRef.current = shareKey;

  const fetchData = useCallback(async (fresh: boolean) => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const key = keyRef.current;
      const value = await (key ? sharedRequest(key, () => loadRef.current(), fresh) : loadRef.current());
      if (id === request.current) setData(value);
    } catch {
      if (id === request.current) setError('No pudimos consultar la información. Actualiza para volver a comprobarla.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  // A reload (after a change) always asks the server again.
  const reload = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    let active = true;
    void fetchData(false);
    const unsubscribe = backend.onChange(() => {
      if (active) reload();
    });
    return () => {
      active = false;
      request.current += 1;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload };
}
