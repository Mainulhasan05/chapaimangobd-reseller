'use client';

import { useEffect, useRef } from 'react';
import { useAppDispatch } from './hooks';
import { api, type Tag } from './api';

/**
 * Refreshes the lists behind a count when the count goes up.
 *
 * The owner's queues used to poll themselves: every paged list refetched every
 * page it had loaded once a minute, so an owner five pages into the orders
 * queue sent five requests a minute for nothing, on 2G. Now one small request
 * is polled (the dashboard counts, the bell) and the lists are refreshed only
 * when it says new work arrived.
 *
 * Only a rise counts. A fall is the owner's own work (an order accepted, a
 * deposit decided), and the mutation that did it already refreshed what it
 * touched; refreshing again would fetch the same lists twice.
 */
export function useRefreshOnRise(counts: number[] | undefined, tags: Tag[]): void {
  const dispatch = useAppDispatch();
  const previous = useRef<number[] | undefined>(undefined);
  // The tags are a literal at the call site; their identity changing is not news.
  const tagsRef = useRef(tags);
  useEffect(() => {
    tagsRef.current = tags;
  });

  const signature = counts?.join(',');
  useEffect(() => {
    if (!counts) return;
    const before = previous.current;
    previous.current = counts;
    if (before && counts.some((value, index) => value > (before[index] ?? 0))) {
      dispatch(api.util.invalidateTags(tagsRef.current));
    }
    // `signature` stands for `counts`, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, dispatch]);
}
