import {
  configureStore,
  createListenerMiddleware,
  isPlain,
  isRejectedWithValue,
} from '@reduxjs/toolkit';
import { ApiError } from '@/lib/api';
import { api } from './api';

/**
 * Values the store may hold besides plain data: the ApiError a failed request
 * carries (screens need its code and field map), and the FormData or File a
 * multipart mutation was called with. Anything else non-serialisable is still
 * reported in development.
 */
function isSerializable(value: unknown): boolean {
  if (isPlain(value)) return true;
  if (value instanceof ApiError) return true;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  return false;
}

/**
 * Two refusals mean the session this screen holds is out of date: the owner
 * issued a temporary password (PASSWORD_CHANGE_REQUIRED) or deactivated the
 * reseller (RESELLER_INACTIVE) after `/auth/me` was last read. Refreshing the
 * session is enough: the shell's redirect and the read-only banner both follow
 * what it says.
 */
const STALE_SESSION = new Set(['PASSWORD_CHANGE_REQUIRED', 'RESELLER_INACTIVE']);

function makeSessionListener() {
  const listener = createListenerMiddleware();
  listener.startListening({
    matcher: isRejectedWithValue,
    effect: (action, { dispatch }) => {
      const error = action.payload;
      if (error instanceof ApiError && STALE_SESSION.has(error.code)) {
        dispatch(api.util.invalidateTags(['Session']));
      }
    },
  });
  return listener;
}

/**
 * One store per browser tab, made inside the provider rather than at module
 * scope, which is what Next asks for so a server render can never share one
 * user's cache with another. See lib/store/provider.tsx.
 */
export function makeStore() {
  const listener = makeSessionListener();
  return configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: { isSerializable },
        immutableCheck: { warnAfter: 128 },
      })
        .prepend(listener.middleware)
        .concat(api.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
