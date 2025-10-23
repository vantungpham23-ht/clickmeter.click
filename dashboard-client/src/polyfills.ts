/**
 * This file includes polyfills needed by Angular and is loaded before the app.
 * You can add your own extra polyfills to this file.
 */

// Suppress Navigator LockManager warnings in development
if (typeof window !== 'undefined' && (window as any).__LOCK_GUARD__) {
  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    if (String(args[0] ?? '').includes('Navigator LockManager')) return;
    origWarn(...args);
  };
}
