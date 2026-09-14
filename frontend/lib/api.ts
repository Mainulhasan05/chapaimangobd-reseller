/**
 * The single way the browser talks to the API.
 *
 * Requests go to a same-origin `/api/*` path, which `next.config.ts` rewrites to
 * the Express server. That keeps the auth cookies first-party `SameSite=Lax` and
 * removes CORS entirely. See docs/adr/0005.
 *
 * Every failure that reaches a component is an ApiError carrying a stable code,
 * including failures where the server was never reached. Wording comes from
 * `lib/errors.ts`, so a user never sees an English server string or a raw
 * "Failed to fetch".
 */

import { TRANSPORT, copyFor, translateField, type ErrorCopy } from './errors';

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
  /** Developer-facing detail. Never shown to a user in production. */
  readonly hint?: string;

  constructor(status: number, body: ApiErrorBody & { hint?: string }) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
    this.hint = body.hint;
  }

  /** True when the server was never reached, so retrying may genuinely help. */
  get isTransport(): boolean {
    return this.status === 0 || Object.keys(TRANSPORT).includes(this.code);
  }
}

const transportError = (code: keyof typeof TRANSPORT, status = 0): ApiError => {
  const copy: ErrorCopy = TRANSPORT[code];
  return new ApiError(status, { code, message: copy.message, hint: copy.hint });
};

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

/**
 * Whether a 401 on this path is worth a refresh. The auth endpoints that issue
 * or revoke tokens are not; `/auth/me` is, because an expired access token with
 * a live refresh token is exactly what a reload after fifteen idle minutes
 * looks like, and treating that as signed out bounced people to the login form.
 */
function canRefresh(path: string): boolean {
  if (!path.startsWith('/auth/')) return true;
  return path === '/auth/me';
}

/*
 * What happens when the session has definitively ended.
 *
 * Registered by the provider that owns the query cache, so this module stays
 * free of React. Signalled at most once: ten queries failing together must
 * produce one redirect, not ten.
 */
type UnauthorizedHandler = () => boolean;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let unauthorizedSignalled = false;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function signalUnauthorized(): void {
  if (unauthorizedSignalled || !unauthorizedHandler) return;
  unauthorizedSignalled = true;
  // A handler that chose not to navigate (a public page) leaves the latch open.
  if (!unauthorizedHandler()) unauthorizedSignalled = false;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /** Milliseconds before giving up. Uploads need longer than a form post. */
  timeoutMs?: number;
  /** Set internally to stop a refresh loop. */
  retrying?: boolean;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** Combines the caller signal with a timeout, without losing either reason. */
function buildSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any is in every browser this app targets (Chrome 111+, Safari 16.4+).
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, retrying } = options;
  const timeoutMs = options.timeoutMs ?? (formData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: buildSignal(signal, timeoutMs),
  };

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (err) {
    // fetch only rejects when the request never completed: the device is offline,
    // the rewrite target refused the connection, or we hit the timeout above.
    if (signal?.aborted) throw err; // A caller cancelling is not an error to report.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw transportError('TIMEOUT');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw transportError('OFFLINE');
    }
    throw transportError('SERVER_UNREACHABLE');
  }

  // An expired access token is recoverable exactly once per request.
  if (response.status === 401 && !retrying && canRefresh(path)) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, retrying: true });
  }

  // The session is gone for good: the refresh failed, or succeeded and the
  // retry was still refused. `/auth/*` is excluded because a 401 there is an
  // answer (`/auth/me` on a public page, a wrong password on login).
  if (response.status === 401 && !path.startsWith('/auth/')) {
    signalUnauthorized();
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Not JSON. Almost always the Next rewrite returning its own error page
    // because nothing is listening on the API port.
    const isGateway = response.status >= 500 || response.status === 0;
    throw transportError(isGateway ? 'SERVER_DOWN' : 'BAD_RESPONSE', response.status);
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
  if (!(error instanceof ApiError) || !error.fields) return {};

  const out: Record<string, string> = {};
  Object.entries(error.fields).forEach(([field, text]) => {
    out[field] = translateField(text);
  });
  return out;
}

/**
 * What to show the user. The server code decides the wording, so the message is
 * in Bengali and says what went wrong, rather than leaking an English string or
 * a browser-level "Failed to fetch".
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return copyFor(error.code)?.message ?? error.message;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return TRANSPORT.TIMEOUT.message;
  }
  if (error instanceof TypeError) {
    // A bare fetch rejection that escaped apiRequest, e.g. from a raw fetch call.
    return TRANSPORT.SERVER_UNREACHABLE.message;
  }
  if (error instanceof Error) return error.message;
  return 'অজানা সমস্যা হয়েছে। আবার চেষ্টা করুন।';
}

/**
 * Developer detail for the same error, shown only outside production so the
 * person running the app locally can see that the backend is simply not up.
 */
export function errorHint(error: unknown): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  if (!(error instanceof ApiError)) return undefined;
  return error.hint ?? copyFor(error.code)?.hint;
}
