/** Bound the entire probe, including response-body reads and abort-ignoring transports. */
export async function withProbeTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 20_000,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const duration = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, 20_000))
    : 20_000;
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    rejectAbort(new Error('Probe cancelled'));
    controller.abort();
  };
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    rejectAbort(new Error('Probe timed out'));
    controller.abort();
  }, duration);
  try {
    if (parent?.aborted) {
      cancel();
      return await cancelled;
    }
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
