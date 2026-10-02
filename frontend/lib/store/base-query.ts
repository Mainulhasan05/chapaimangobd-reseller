import type { BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * What an endpoint hands the base query: a path, or a path with the rest of a
 * request. Mirrors `apiRequest`'s options so the endpoint definitions read like
 * the calls they replaced.
 */
export type ApiArgs =
  | string
  | {
      url: string;
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: unknown;
      /** Multipart. Uploads get the longer upload timeout automatically. */
      formData?: FormData;
      timeoutMs?: number;
    };

/**
 * The one bridge between RTK Query and the API.
 *
 * Every request still goes through `apiRequest`, so the shared token refresh,
 * the timeout, the offline and server-down translation and the session-ended
 * redirect all keep working exactly as they did. RTK Query only adds the cache,
 * the de-duplication of identical requests and the tag-based refresh.
 *
 * The error is the ApiError itself rather than a serialised copy, because every
 * screen reads it through `errorMessage()` and `fieldErrors()`, which need the
 * code and the field map. The store's serialisability check is told to accept
 * it; see store.ts.
 */
export const apiBaseQuery: BaseQueryFn<ApiArgs, unknown, ApiError> = async (args, { signal }) => {
  const request = typeof args === 'string' ? { url: args } : args;
  try {
    const data = await apiRequest<unknown>(request.url, {
      method: request.method ?? 'GET',
      body: request.body,
      formData: request.formData,
      timeoutMs: request.timeoutMs,
      signal,
    });
    return { data };
  } catch (error) {
    if (error instanceof ApiError) return { error };
    // A caller abort (a component unmounting) is not something to show anyone.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: new ApiError(0, { code: 'ABORTED', message: 'aborted' }) };
    }
    return {
      error: new ApiError(0, {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : 'অজানা সমস্যা',
      }),
    };
  }
};

/**
 * Builds a query string from an object, dropping empty values, so an endpoint
 * never sends `?status=&q=` and two calls that mean the same thing share one
 * cache entry. Arrays are joined with commas, which is what the API's list
 * filters expect.
 */
export function qs(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.keys(params)
    .sort()
    .forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null || value === '' || value === false) return;
      if (Array.isArray(value)) {
        if (value.length) search.set(key, value.join(','));
        return;
      }
      search.set(key, String(value));
    });
  const text = search.toString();
  return text ? `?${text}` : '';
}
