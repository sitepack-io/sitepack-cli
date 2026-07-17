import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { Command } from 'commander';

vi.mock('axios');
vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('inquirer', () => ({
    default: { prompt: vi.fn(), Separator: class {} },
}));

const axios = (await import('axios')).default;
const inquirer = (await import('inquirer')).default;

let tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));

const loginCommand = (await import('../src/commands/login.js')).default;
const logoutCommand = (await import('../src/commands/logout.js')).default;
const { getToken, getSelectedPartner, saveToken } = await import('../src/utils/auth.js');

const PARTNER = { uuid: 'partner-1', company_name: 'Test Partner BV' };

describe('sitepack login', () => {
    let cwd;
    let output;

    const run = async (register, name) => {
        const program = new Command();
        program.exitOverride();
        register(program);
        await program.parseAsync(['node', 'sitepack', name]);
    };

    beforeEach(() => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-cwd-'));
        output = [];

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(cwd);
        vi.spyOn(console, 'log').mockImplementation((message) => output.push(String(message)));
        vi.spyOn(console, 'error').mockImplementation((message) => output.push(String(message)));

        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

        axios.mockReset();
        axios.post.mockReset();
        inquirer.prompt.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(cwd);
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
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

    const tokenResponse = {
        data: {
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 3600,
            scope: 'console:access sites:list apps:manage themes:manage',
        },
    };

    /**
     * The whole "sitepack login": device code, approval, token, then the
     * organisation picker that runs at the very end of the command.
     */
    it('logs in and stores the selected organisation', async () => {
        axios.post.mockResolvedValueOnce(deviceCodeResponse).mockResolvedValueOnce(tokenResponse);
        axios.mockResolvedValue({ data: { status: 'success', partners: [PARTNER] } });
        inquirer.prompt.mockResolvedValue({ partnerUuid: PARTNER.uuid });

        const login = run(loginCommand, 'login');
        await settle();
        await poll();
        await login;

        expect((await getToken()).access_token).toBe('access-1');
        expect(await getSelectedPartner()).toBe(PARTNER.uuid);
        expect(output.join('\n')).toContain('Logged in successfully!');
        // The scopes come back as a space separated "scope" string.
        expect(output.join('\n')).toContain('themes:manage');
        expect(output.join('\n')).toContain('Test Partner BV');
    });

    it('reports a failure to fetch the organisations without losing the token', async () => {
        axios.post.mockResolvedValueOnce(deviceCodeResponse).mockResolvedValueOnce(tokenResponse);
        axios.mockRejectedValue({
            message: 'Request failed with status code 500',
            response: { status: 500, data: '<html>Server Error</html>' },
        });

        const login = run(loginCommand, 'login');
        await settle();
        await poll();
        await login;

        // The login itself worked, so the token must survive.
        expect((await getToken()).access_token).toBe('access-1');
        expect(output.join('\n')).toContain('Authentication failed');
    });

    it('reports a denied authorization', async () => {
        axios.post
            .mockResolvedValueOnce(deviceCodeResponse)
            .mockRejectedValueOnce({ response: { data: { error: 'access_denied' } } });

        const login = run(loginCommand, 'login');
        await settle();
        await poll();
        await login;

        expect(await getToken()).toBeNull();
        expect(output.join('\n')).toContain('The user denied the request.');
    });
});

describe('sitepack logout', () => {
    let cwd;

    const run = async () => {
        const program = new Command();
        program.exitOverride();
        logoutCommand(program);
        await program.parseAsync(['node', 'sitepack', 'logout']);
    };

    beforeEach(() => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-cwd-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(cwd);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        axios.post.mockReset();
        inquirer.prompt.mockReset();
        inquirer.prompt.mockResolvedValue({ confirm: true });
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(cwd);
    });

    it('revokes the token with the body the revoke endpoint expects', async () => {
        await saveToken({ access_token: 'access-1', refresh_token: 'refresh-1' });
        axios.post.mockResolvedValue({ data: { status: 'revoked' } });

        await run();

        expect(axios.post).toHaveBeenCalledWith(
            'https://admin.sitepack.eu/api/authentication/oauth/revoke',
            { token: 'access-1' },
        );
        expect(await getToken()).toBeNull();
    });

    it('keeps the session when the developer cancels', async () => {
        await saveToken({ access_token: 'access-1' });
        inquirer.prompt.mockResolvedValue({ confirm: false });

        await run();

        expect(axios.post).not.toHaveBeenCalled();
        expect((await getToken()).access_token).toBe('access-1');
    });
});
