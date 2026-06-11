// Central error/telemetry sink. Today it only writes to the console, but every
// catch site that matters (ErrorBoundary, the AI pipeline, best-effort network
// failures) routes through here — so wiring a real crash reporter later is a
// one-function change instead of a hunt through the codebase.
//
// To enable Sentry (or similar): `expo install @sentry/react-native`, init it
// once in App.tsx, then forward to it from logError/addBreadcrumb below. Nothing
// else in the app needs to change.

type LogContext = Record<string, unknown>;

declare const __DEV__: boolean;

// Report a handled error. `context` carries a scope tag and any small,
// non-sensitive detail that helps explain it (e.g. the failing query).
export function logError(error: unknown, context?: LogContext) {
  // e.g. Sentry.captureException(error, { extra: context });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error('[FilmRoulette]', error, context ?? '');
  } else {
    // Keep a production breadcrumb without leaking context objects to logs.
    console.error('[FilmRoulette]', error);
  }
}

// A lightweight trail of "what happened before the error" for future reporters.
// No-op beyond the dev console for now, but call sites can adopt it freely.
export function addBreadcrumb(message: string, context?: LogContext) {
  // e.g. Sentry.addBreadcrumb({ message, data: context });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[FilmRoulette]', message, context ?? '');
  }
}
