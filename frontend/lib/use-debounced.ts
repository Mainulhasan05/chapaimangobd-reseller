'use client';

import { useEffect, useState } from 'react';

/**
 * Holds a value still until typing stops.
 *
 * Search boxes here feed a query key, and without this every keystroke is a
 * request. On a slow connection that is a queue of responses arriving out of
 * order behind the one the user is waiting for.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
