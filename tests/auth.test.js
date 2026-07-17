import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import fs from 'fs';

vi.mock('axios');
vi.mock('open', () => ({ default: vi.fn() }));

const axios = (await import('axios')).default;
const open = (await import('open')).default;

// A real temporary home, so the config-file handling is exercised for real
// rather than mocked away.
let tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));

const {
    getBaseUrl,
    getThemeCdnUrl,
    saveToken,
    getToken,
    callApi,
    isTokenValid,
    refreshToken,
    logout,
    performLogin,
    saveSelectedPartner,
    getSelectedPartner,
} = await import('../src/utils/auth.js');

const configPath = () => path.join(tempHome, '.sitepackconfig');

describe('sitepack auth', () => {
    let cwd;

    beforeEach(() => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-cwd-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(cwd);

        // A queued "...Once" response left over from a previous test would
        // otherwise be handed to the next one.
        axios.mockReset();
        axios.post.mockReset();
        open.mockReset();
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(cwd);
    });

    describe('configuration', () => {
        it('defaults to the production hosts', async () => {
            expect(await getBaseUrl()).toBe('https://admin.sitepack.eu');
            expect(await getThemeCdnUrl()).toBe('https://sync.sitepack.dev/themes');
        });

        it('lets a local sitepack.config.json override the base url', async () => {
            fsExtra.writeJsonSync(path.join(cwd, 'sitepack.config.json'), { base_url: 'http://core.local' });

            expect(await getBaseUrl()).toBe('http://core.local');
        });

        it('stores the token with owner-only permissions', async () => {
            await saveToken({ access_token: 'abc', refresh_token: 'def' });

            const mode = fs.statSync(configPath()).mode & 0o777;
            expect(mode).toBe(0o600);
            expect((await getToken()).access_token).toBe('abc');
        });

        it('keeps the selected partner alongside the token', async () => {
            await saveToken({ access_token: 'abc' });
            await saveSelectedPartner('partner-uuid');

            expect(await getSelectedPartner()).toBe('partner-uuid');
            expect((await getToken()).access_token).toBe('abc');
        });

        it('returns no token when nothing is stored', async () => {
            expect(await getToken()).toBeNull();
        });
    });

    describe('isTokenValid', () => {
        it('is false without a token', async () => {
            expect(await isTokenValid()).toBe(false);
        });

        it('is true for a token that has not expired', async () => {
            await saveToken({ access_token: 'abc', expires_at: Date.now() + 60_000 });

            expect(await isTokenValid()).toBe(true);
        });

        it('is false for an expired token without a refresh token', async () => {
            await saveToken({ access_token: 'abc', expires_at: Date.now() - 1 });

            expect(await isTokenValid()).toBe(false);
        });

        it('refreshes an expired token when a refresh token is available', async () => {
            await saveToken({ access_token: 'old', refresh_token: 'r', client_id: 'c', expires_at: Date.now() - 1 });
            axios.post.mockResolvedValue({
                data: { access_token: 'new', refresh_token: 'r2', expires_in: 3600, scope: 'themes:manage' },
            });

            expect(await isTokenValid()).toBe(true);
            expect((await getToken()).access_token).toBe('new');
        });
    });

    describe('refreshToken', () => {
        it('stores the scopes from the space separated scope string', async () => {
            await saveToken({ access_token: 'old', refresh_token: 'r', client_id: 'c' });
            axios.post.mockResolvedValue({
                data: { access_token: 'new', expires_in: 3600, scope: 'console:access themes:manage' },
            });

            const refreshed = await refreshToken();

            expect(refreshed.scopes).toEqual(['console:access', 'themes:manage']);
            // The server did not return a new refresh token, so the old one stays.
            expect(refreshed.refresh_token).toBe('r');
        });

        it('returns null when there is no refresh token', async () => {
            await saveToken({ access_token: 'old' });

            expect(await refreshToken()).toBeNull();
        });

        it('returns null when the server rejects the refresh', async () => {
            await saveToken({ access_token: 'old', refresh_token: 'r', client_id: 'c' });
            axios.post.mockRejectedValue({ response: { status: 400, data: { error: 'invalid_grant' } } });

            expect(await refreshToken()).toBeNull();
        });
    });

    describe('callApi', () => {
        it('refuses to call when not logged in', async () => {
            await expect(callApi({ method: 'get', url: 'https://x/y' })).rejects.toThrow('Not logged in');
        });

        it('sends the access token header', async () => {
            await saveToken({ access_token: 'abc' });
            axios.mockResolvedValue({ data: { ok: true } });

            await callApi({ method: 'get', url: 'https://x/y' });

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({ headers: { 'X-SitePack-Access-Token': 'abc' } }),
            );
        });

        it('preserves extra headers such as the theme uuid', async () => {
            await saveToken({ access_token: 'abc' });
            axios.mockResolvedValue({ data: { ok: true } });

            await callApi({ method: 'post', url: 'https://x/y', headers: { 'X-Theme-Uuid': 'uuid-1' } });

            expect(axios).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: { 'X-Theme-Uuid': 'uuid-1', 'X-SitePack-Access-Token': 'abc' },
                }),
            );
        });

        it('refreshes and retries once on a 401', async () => {
            await saveToken({ access_token: 'old', refresh_token: 'r', client_id: 'c' });
            axios.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ data: { ok: true } });
            axios.post.mockResolvedValue({ data: { access_token: 'new', expires_in: 3600, scope: 'themes:manage' } });

            const response = await callApi({ method: 'get', url: 'https://x/y' });

            expect(response.data).toEqual({ ok: true });
            expect(axios).toHaveBeenCalledTimes(2);
            expect(axios).toHaveBeenLastCalledWith(
                expect.objectContaining({ headers: { 'X-SitePack-Access-Token': 'new' } }),
            );
        });

        it('gives up when the refresh also fails', async () => {
            await saveToken({ access_token: 'old', refresh_token: 'r', client_id: 'c' });
            axios.mockRejectedValue({ response: { status: 401 } });
            axios.post.mockRejectedValue({ response: { status: 400 } });

            await expect(callApi({ method: 'get', url: 'https://x/y' })).rejects.toMatchObject({
                response: { status: 401 },
            });
        });

        it('does not swallow a server error', async () => {
            await saveToken({ access_token: 'abc' });
            axios.mockRejectedValue({ response: { status: 500, data: { error: 'boom' } } });

            await expect(callApi({ method: 'get', url: 'https://x/y' })).rejects.toMatchObject({
                response: { status: 500 },
            });
        });
    });

    describe('logout', () => {
        it('revokes the token on the server and clears the local config', async () => {
            await saveToken({ access_token: 'abc', refresh_token: 'r', client_id: 'c' });
            axios.post.mockResolvedValue({ data: { status: 'revoked' } });

            await logout();

            expect(axios.post).toHaveBeenCalledWith(
                'https://admin.sitepack.eu/api/authentication/oauth/revoke',
                { token: 'abc' },
            );
            expect(await getToken()).toBeNull();
        });

        it('clears the local token even when the server call fails', async () => {
            await saveToken({ access_token: 'abc' });
            axios.post.mockRejectedValue(new Error('offline'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await logout();

            expect(await getToken()).toBeNull();
        });

        it('keeps unrelated settings such as the selected partner file entry', async () => {
            await saveToken({ access_token: 'abc' });
            await saveSelectedPartner('partner-uuid');
            axios.post.mockResolvedValue({ data: {} });

            await logout();

            expect(await getSelectedPartner()).toBe('partner-uuid');
            expect(await getToken()).toBeNull();
        });
    });

    describe('performLogin', () => {
        // Only the polling interval is faked: the test still needs real timers to
        // let the pending request promises and config writes settle.
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
            vi.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        /** Hands the event loop back so pending promises settle. */
        const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

        /** Fires the next poll and waits for it to be handled. */
        const poll = async () => {
            vi.advanceTimersByTime(5_000);
            await settle();
        };

        const deviceCodeResponse = {
            data: {
                client_id: 'server-client-id',
                device_code: 'device-code',
                user_code: 'ABCD-1234',
                verification_uri: 'https://admin.sitepack.eu/admin/oauth/device/activate?user_code=ABCD-1234',
                expires_in: 300,
                interval: 5,
            },
        };

        it('polls until the user approves and stores the token', async () => {
            axios.post
                .mockResolvedValueOnce(deviceCodeResponse)
                .mockRejectedValueOnce({ response: { data: { error: 'authorization_pending' } } })
                .mockResolvedValueOnce({
                    data: {
                        access_token: 'access-1',
                        refresh_token: 'refresh-1',
                        expires_in: 3600,
                        scope: 'console:access themes:manage',
                    },
                });

            const login = performLogin();
            await settle();
            await poll(); // authorization_pending
            await poll(); // approved
            const token = await login;

            expect(token.access_token).toBe('access-1');
            expect(token.scopes).toEqual(['console:access', 'themes:manage']);
            // The client_id the server hands back is what the poll must use.
            expect(token.client_id).toBe('server-client-id');
            expect(await getToken()).toMatchObject({ access_token: 'access-1' });
            expect(open).toHaveBeenCalledWith(deviceCodeResponse.data.verification_uri);
        });

        it('reports a denied authorization', async () => {
            axios.post
                .mockResolvedValueOnce(deviceCodeResponse)
                .mockRejectedValueOnce({ response: { data: { error: 'access_denied' } } });

            const login = performLogin();
            const assertion = expect(login).rejects.toThrow('The user denied the request.');
            await settle();
            await poll();
            await assertion;
        });

        it('reports an expired device code', async () => {
            axios.post
                .mockResolvedValueOnce(deviceCodeResponse)
                .mockRejectedValueOnce({ response: { data: { error: 'expired_token' } } });

            const login = performLogin();
            const assertion = expect(login).rejects.toThrow('The device code has expired.');
            await settle();
            await poll();
            await assertion;
        });

        /**
         * A crash in the token endpoint used to surface as a bare
         * "Request failed with status code 500".
         */
        it('explains a server error during polling', async () => {
            axios.post.mockResolvedValueOnce(deviceCodeResponse).mockRejectedValueOnce({
                message: 'Request failed with status code 500',
                response: { status: 500, data: '<html>Server Error</html>' },
            });

            const login = performLogin();
            const assertion = expect(login).rejects.toThrow(/HTTP 500/);
            await settle();
            await poll();
            await assertion;
        });

        it('explains a failure to start the login', async () => {
            axios.post.mockRejectedValueOnce({
                message: 'Request failed with status code 500',
                response: { status: 500, data: '<html>Server Error</html>' },
            });

            await expect(performLogin()).rejects.toThrow(/Failed to initiate login.*HTTP 500/);
        });
    });
});
