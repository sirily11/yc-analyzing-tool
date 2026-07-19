const DEFAULT_RETRY_DELAYS_MS = [100, 400] as const;

type PersistenceOptions = {
  retryDelaysMs?: readonly number[];
  onFailure?: (cause: unknown) => void;
};

/**
 * Persist a completed chat stream without letting a transient database outage
 * tear down the response that the browser has already received.
 */
export async function persistChatCompletion(
  persist: () => Promise<void>,
  options: PersistenceOptions = {},
) {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      await persist();
      return true;
    } catch (cause) {
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs === undefined) {
        options.onFailure?.(cause);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
