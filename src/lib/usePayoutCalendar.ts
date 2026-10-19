import { useEffect, useState } from 'react';
import { platformApi, usePlatformQuery } from './platform';

export function usePayoutClock() {
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return at;
}

export function usePayoutCalendar() {
  const query = usePlatformQuery(() => platformApi.payoutCalendar(), [], null);
  const at = usePayoutClock();
  return { ...query, at };
}
