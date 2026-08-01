/**
 * Small retry helper for flaky network calls.
 *
 * Sync uploads occasionally fail on a transient error (a timed-out request,
 * HTTP 408), so a single retry turns most of those into a success without the
 * developer having to notice.
 */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs an async operation, retrying it a fixed number of extra times before
 * giving up. The operation is re-invoked from scratch on every attempt, so it
 * is safe to (re)build one-shot resources — a FormData with a fresh read
 * stream, for instance — inside it.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} operation - run once per attempt (0-indexed)
 * @param {object} [options]
 * @param {number} [options.retries=1] - extra attempts after the first
 * @param {number} [options.delayMs=500] - pause between attempts
 * @param {(error: any, nextAttempt: number) => void} [options.onRetry] - called before each retry
 * @returns {Promise<T>}
 */
export async function withRetry(operation, { retries = 1, delayMs = 500, onRetry } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;

            if (attempt < retries) {
                if (onRetry) {
                    onRetry(error, attempt + 1);
                }
                if (delayMs > 0) {
                    await wait(delayMs);
                }
            }
        }
    }

    throw lastError;
}
