import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry } from '../src/utils/retry.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('withRetry', () => {
    it('returns the result without retrying when the operation succeeds', async () => {
        const operation = vi.fn(async () => 'ok');

        const result = await withRetry(operation, { retries: 1, delayMs: 0 });

        expect(result).toBe('ok');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries once and succeeds on the second attempt', async () => {
        const operation = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('recovered');
        const onRetry = vi.fn();

        const result = await withRetry(operation, { retries: 1, delayMs: 0, onRetry });

        expect(result).toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('throws the last error once the retries are exhausted', async () => {
        const error = new Error('still down');
        const operation = vi.fn(async () => { throw error; });

        await expect(withRetry(operation, { retries: 1, delayMs: 0 })).rejects.toBe(error);
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('honours a higher retry count', async () => {
        const operation = vi.fn(async () => { throw new Error('nope'); });

        await expect(withRetry(operation, { retries: 3, delayMs: 0 })).rejects.toThrow('nope');
        expect(operation).toHaveBeenCalledTimes(4);
    });

    it('does not retry when retries is 0', async () => {
        const operation = vi.fn(async () => { throw new Error('once is enough'); });

        await expect(withRetry(operation, { retries: 0, delayMs: 0 })).rejects.toThrow('once is enough');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    /** The callers rely on the defaults: withRetry(fn) has to try twice. */
    it('retries once by default', async () => {
        vi.useFakeTimers();
        const operation = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('recovered');

        const result = withRetry(operation);
        await vi.advanceTimersByTimeAsync(500);

        await expect(result).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('waits the configured delay before trying again', async () => {
        vi.useFakeTimers();
        const operation = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('recovered');

        const result = withRetry(operation, { retries: 1, delayMs: 1000 });

        await vi.advanceTimersByTimeAsync(999);
        expect(operation).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
    });

    /**
     * The operation is re-invoked from scratch every attempt, so a caller can
     * rebuild a one-shot body (a FormData around a read stream) inside it.
     */
    it('runs the operation again from scratch on every attempt', async () => {
        const attempts = [];
        const operation = vi.fn(async (attempt) => {
            attempts.push(attempt);
            if (attempt < 2) throw new Error('not yet');
            return 'third time lucky';
        });

        const result = await withRetry(operation, { retries: 2, delayMs: 0 });

        expect(result).toBe('third time lucky');
        expect(attempts).toEqual([0, 1, 2]);
    });

    it('tells onRetry which error it is retrying and which attempt comes next', async () => {
        const first = new Error('first');
        const second = new Error('second');
        const operation = vi.fn()
            .mockRejectedValueOnce(first)
            .mockRejectedValueOnce(second)
            .mockResolvedValueOnce('recovered');
        const onRetry = vi.fn();

        await withRetry(operation, { retries: 2, delayMs: 0, onRetry });

        expect(onRetry).toHaveBeenNthCalledWith(1, first, 1);
        expect(onRetry).toHaveBeenNthCalledWith(2, second, 2);
    });

    it('does not announce a retry that will never happen', async () => {
        const operation = vi.fn(async () => { throw new Error('down'); });
        const onRetry = vi.fn();

        await expect(withRetry(operation, { retries: 1, delayMs: 0, onRetry })).rejects.toThrow('down');

        // Announced the one retry, and stayed quiet after the final failure.
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not announce a retry when the first attempt succeeds', async () => {
        const onRetry = vi.fn();

        await withRetry(async () => 'ok', { retries: 1, delayMs: 0, onRetry });

        expect(onRetry).not.toHaveBeenCalled();
    });

    /** Callers pass plain arrow functions, which can throw before returning a promise. */
    it('retries an operation that throws synchronously', async () => {
        let calls = 0;
        const operation = vi.fn(() => {
            calls += 1;
            if (calls === 1) throw new Error('sync boom');
            return Promise.resolve('recovered');
        });

        await expect(withRetry(operation, { retries: 1, delayMs: 0 })).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('treats a falsy result as a success', async () => {
        const operation = vi.fn(async () => null);

        await expect(withRetry(operation, { retries: 1, delayMs: 0 })).resolves.toBeNull();
        expect(operation).toHaveBeenCalledTimes(1);
    });
});
