import { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from './backend';

// Loads data from the backend, reloads when deps change or the backend reports a
// change (e.g. another tab), and exposes a manual reload for after mutations.
export function useBackendData<T>(load: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const value = await loadRef.current();
      if (id === request.current) setData(value);
    } catch {
      if (id === request.current) setError('No pudimos consultar la información. Actualiza para volver a comprobarla.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void reload();
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
