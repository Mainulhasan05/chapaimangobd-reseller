/**
 * The single way the browser talks to the API.
 *
 * Requests go to a same-origin `/api/*` path, which `next.config.ts` rewrites to
 * the Express server. That keeps the auth cookies first-party `SameSite=Lax` and
 * removes CORS entirely. See docs/adr/0005.
 */

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export type ApiErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

/**
 * One in-flight refresh, shared. Ten parallel queries hitting a stale access
 * token would otherwise each burn a refresh token and trip reuse detection,
 * which revokes the whole device family and signs the user out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /** Set internally to stop a refresh loop. */
  retrying?: boolean;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, retrying } = options;

  const init: RequestInit = { method, credentials: 'include', signal };

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, init);

  // An expired access token is recoverable exactly once per request.
  if (response.status === 401 && !retrying && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, retrying: true });
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(response.status, {
      code: 'BAD_RESPONSE',
      message: 'সার্ভার থেকে সঠিক উত্তর পাওয়া যায়নি',
    });
  }

  if (!response.ok || !payload.ok) {
    const error = 'error' in payload ? payload.error : undefined;
    throw new ApiError(response.status, error ?? { code: 'UNKNOWN', message: 'অজানা সমস্যা' });
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, method = 'POST') =>
    apiRequest<T>(path, { method, formData }),
};

/** Turns an API field error map into something react-hook-form can consume. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError && error.fields ? error.fields : {};
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'অজানা সমস্যা হয়েছে';
}
