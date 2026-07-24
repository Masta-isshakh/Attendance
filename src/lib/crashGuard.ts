/**
 * Catches otherwise-fatal JavaScript errors so the app shows a message instead
 * of closing to the home screen, and so the actual error text is visible for
 * diagnosis. Native crashes cannot be caught here — if the app still closes
 * silently with this installed, the cause is native, not JS.
 *
 * Installed from index.ts BEFORE the app registers, so it is active during the
 * earliest module evaluation.
 */
type ErrorUtilsShape = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let capturedError: string | null = null;
const listeners = new Set<(message: string) => void>();

function format(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

export function installCrashGuard(): void {
  const globalAny = globalThis as unknown as {
    __crashGuardInstalled?: boolean;
    ErrorUtils?: ErrorUtilsShape;
  };
  if (globalAny.__crashGuardInstalled) return;
  globalAny.__crashGuardInstalled = true;

  const errorUtils = globalAny.ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const message = format(error);
    capturedError = message;
    listeners.forEach((listener) => listener(message));

    // eslint-disable-next-line no-console
    console.error('[crashGuard]', isFatal ? 'FATAL' : 'non-fatal', error);

    // For a fatal error, deliberately do NOT delegate to the previous handler:
    // the default handler closes the app. Keeping it alive lets the user read
    // the error. Non-fatal errors are forwarded so normal reporting continues.
    if (!isFatal && previous) previous(error, isFatal);
  });
}

export function subscribeToCrash(callback: (message: string) => void): () => void {
  listeners.add(callback);
  if (capturedError) callback(capturedError);
  return () => {
    listeners.delete(callback);
  };
}

export function getCapturedError(): string | null {
  return capturedError;
}

export function clearCapturedError(): void {
  capturedError = null;
}
