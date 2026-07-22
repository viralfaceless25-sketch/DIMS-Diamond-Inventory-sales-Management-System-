export interface ReadinessOptions {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
}

export async function waitForApiReady(
  apiUrl: string,
  options: ReadinessOptions = {}
): Promise<'ready' | 'timeout'> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const deadline = now() + timeoutMs;
  const readinessUrl = `${apiUrl.replace(/\/$/, '')}/ready`;

  while (now() < deadline) {
    const controller = new AbortController();
    const remainingMs = Math.max(1, deadline - now());
    const requestTimer = setTimeout(
      () => controller.abort(),
      Math.min(requestTimeoutMs, remainingMs)
    );
    try {
      if ((await fetcher(readinessUrl, { cache: 'no-store', signal: controller.signal })).ok) {
        return 'ready';
      }
    } catch {
      // A sleeping or temporarily unreachable free service is expected here.
    } finally {
      clearTimeout(requestTimer);
    }
    await sleep(intervalMs);
  }

  return 'timeout';
}
