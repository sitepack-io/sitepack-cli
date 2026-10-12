import { vi, expect } from 'vitest';

/**
 * Helpers for driving the device-code login (performLogin) in tests that fake only
 * setInterval/clearInterval.
 */

/**
 * Waits until the login has requested its device code and started polling. Before
 * that a fake tick hits nothing, so wait for the interval itself rather than a fixed
 * delay: reading the config and opening the browser can take longer than any delay
 * on a slow CI machine.
 */
export async function pollingStarted() {
    const deadline = Date.now() + 4_000;
    while (vi.getTimerCount() === 0) {
        if (Date.now() > deadline) throw new Error('The login never started polling');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/**
 * Fires the next poll: the interval asks the token endpoint once.
 *
 * @param {import('vitest').Mock} post the mocked axios.post
 */
export function poll(post) {
    const requests = post.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(post.mock.calls.length).toBe(requests + 1);
}
