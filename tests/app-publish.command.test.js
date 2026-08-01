import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { Command } from 'commander';

vi.mock('axios');
vi.mock('inquirer', () => ({
    default: { prompt: vi.fn(), Separator: class {} },
}));
vi.mock('ora', () => {
    const spinner = {
        start: vi.fn(function () { return this; }),
        succeed: vi.fn(function () { return this; }),
        fail: vi.fn(function () { return this; }),
        text: '',
    };
    return { default: vi.fn(() => spinner), __spinner: spinner };
});

const axios = (await import('axios')).default;
const inquirer = (await import('inquirer')).default;
const oraModule = await import('ora');
const spinner = oraModule.__spinner;

let tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));

const appPublishCommand = (await import('../src/commands/app-publish.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const APP_UUID = '019f7a1b-2c3d-7e4f-8a9b-0c1d2e3f4a5b';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

describe('sitepack app:publish', () => {
    let appDir;

    /** Runs the command exactly as the CLI entry point does. */
    const runPublish = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        appPublishCommand(program);
        await program.parseAsync(['node', 'sitepack', 'app:publish', ...args]);
    };

    /** The requests the CLI made, as { method, url }. */
    const requests = () => axios.mock.calls.map(([config]) => ({ method: config.method, url: config.url }));

    const requestedUrls = () => requests().map((c) => c.url);

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-app-'));

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(appDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        axios.mockResolvedValue({ data: { status: 'ok' } });
        inquirer.prompt.mockReset();
        spinner.succeed.mockClear();
        spinner.fail.mockClear();

        // A logged-in developer, in an app directory, who confirms the publish.
        await saveToken({ access_token: 'token-abc', expires_at: Date.now() + 60_000 });
        await saveSelectedPartner(PARTNER_UUID);
        inquirer.prompt.mockResolvedValue({ confirmPublish: true });

        fsExtra.writeJsonSync(path.join(appDir, 'app.json'), { uuid: APP_UUID, name: 'Test App' });
        fsExtra.ensureDirSync(path.join(appDir, 'templates'));
        fs.writeFileSync(path.join(appDir, 'templates', 'index.twig'), '<h1>{{ title }}</h1>');
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(appDir);
    });

    it('syncs the app files and publishes a new version', async () => {
        axios.mockResolvedValue({ data: { status: 'ok', version: 4 } });

        await runPublish();

        const urls = requestedUrls();
        // Fresh marker, then the files, then publish.
        expect(urls[0]).toBe(`https://sync.sitepack.dev/apps/${APP_UUID}/`);
        expect(urls).toContain(`https://sync.sitepack.dev/apps/${APP_UUID}/app.json`);
        expect(urls).toContain(`https://sync.sitepack.dev/apps/${APP_UUID}/templates/index.twig`);
        expect(urls.at(-1)).toBe(`https://sync.sitepack.dev/apps/${APP_UUID}/publish`);

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('New version: 4'));
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('sends the app and partner headers on every request', async () => {
        await runPublish();

        for (const [config] of axios.mock.calls) {
            expect(config.headers['X-App-Uuid']).toBe(APP_UUID);
            expect(config.headers['X-SitePack-Partner']).toBe(PARTNER_UUID);
            expect(config.headers['X-SitePack-Access-Token']).toBe('token-abc');
        }
    });

    it('marks the sync as fresh so the server drops removed files', async () => {
        await runPublish();

        const [freshCall] = axios.mock.calls[0];
        expect(freshCall.headers['X-Fresh']).toBe('true');
    });

    /**
     * The publish endpoint reports the version as new_app_version too; the CLI
     * used to only read "version" and silently dropped it from the message.
     */
    it('reports the version from new_app_version', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/publish')) {
                return { data: { status: 'ok', new_app_version: 12 } };
            }
            return { data: { status: 'ok' } };
        });

        await runPublish();

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('New version: 12'));
    });

    it('still reports success when the server returns no version', async () => {
        await runPublish();

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('published successfully'));
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('shows the server message when publishing fails', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/publish')) {
                return Promise.reject({
                    response: { status: 400, data: { error: 'No files have been uploaded for this app yet' } },
                });
            }
            return { data: { status: 'ok' } };
        });

        await runPublish();

        expect(spinner.fail).toHaveBeenCalledWith(
            expect.stringContaining('No files have been uploaded for this app yet'),
        );
    });

    /**
     * A crash on the server used to reach the user as a bare
     * "Request failed with status code 500".
     */
    it('explains a server error that returns an html page', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/publish')) {
                return Promise.reject({
                    message: 'Request failed with status code 500',
                    response: { status: 500, data: '<html><body>Server Error</body></html>' },
                });
            }
            return { data: { status: 'ok' } };
        });

        await runPublish();

        const [message] = spinner.fail.mock.calls.at(-1);
        expect(message).toContain('HTTP 500');
        expect(message).not.toContain('<html>');
    });

    it('does not publish when the file sync fails', async () => {
        axios.mockRejectedValue({ response: { status: 422, data: { error: 'File type not allowed' } } });

        await runPublish();

        expect(requestedUrls().some((url) => url.endsWith('/publish'))).toBe(false);
        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('File type not allowed'));
    });

    it('refuses to run when app.json is not valid json', async () => {
        fs.writeFileSync(path.join(appDir, 'app.json'), '{ "uuid": broken }');

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('aborts the publish when a json file in the app fails to parse', async () => {
        fsExtra.ensureDirSync(path.join(appDir, 'assets'));
        fs.writeFileSync(path.join(appDir, 'assets', 'config.json'), '{ "hello": broken }');

        await runPublish();

        // Only the fresh marker went out; no file was uploaded and nothing was published.
        const urls = requestedUrls();
        expect(urls.some((url) => url.endsWith('app.json'))).toBe(false);
        expect(urls.some((url) => url.endsWith('/publish'))).toBe(false);
        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Publish aborted'));
    });

    /**
     * The server only accepts app.json at the app root and the templates /
     * assets directories. The CLI used to upload every file it found, so an app
     * with a README.md had its whole publish rejected with a 422.
     */
    it('does not upload files outside the app structure', async () => {
        fs.writeFileSync(path.join(appDir, 'README.md'), '# My app');
        fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"my-app"}');
        fsExtra.writeJsonSync(path.join(appDir, 'sitepack.config.json'), { base_url: 'http://core.local' });
        fsExtra.ensureDirSync(path.join(appDir, 'scratch'));
        fs.writeFileSync(path.join(appDir, 'scratch', 'draft.twig'), 'draft');
        fsExtra.ensureDirSync(path.join(appDir, 'node_modules', 'pkg'));
        fs.writeFileSync(path.join(appDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');

        await runPublish();

        const urls = requestedUrls();
        expect(urls.some((url) => url.endsWith('README.md'))).toBe(false);
        expect(urls.some((url) => url.endsWith('package.json'))).toBe(false);
        expect(urls.some((url) => url.endsWith('sitepack.config.json'))).toBe(false);
        expect(urls.some((url) => url.includes('scratch'))).toBe(false);
        expect(urls.some((url) => url.includes('node_modules'))).toBe(false);
        // app.json is the one root file that is meant to go up.
        expect(urls.some((url) => url.endsWith('app.json'))).toBe(true);
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    /**
     * A stray json file outside the app structure is none of the CLI's
     * business, so it must not block the publish either.
     */
    it('ignores an invalid json file outside the app structure', async () => {
        fs.writeFileSync(path.join(appDir, 'tsconfig.json'), '{ "compilerOptions": broken }');

        await runPublish();

        expect(requestedUrls().some((url) => url.endsWith('/publish'))).toBe(true);
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('uploads the assets directory', async () => {
        fsExtra.ensureDirSync(path.join(appDir, 'assets'));
        fs.writeFileSync(path.join(appDir, 'assets', 'style.css'), 'body { margin: 0 }');

        await runPublish();

        expect(requestedUrls()).toContain(`https://sync.sitepack.dev/apps/${APP_UUID}/assets/style.css`);
    });

    it('honours .sitepackignore', async () => {
        fs.writeFileSync(path.join(appDir, '.sitepackignore'), 'templates/index.twig\n');

        await runPublish();

        expect(requestedUrls().some((url) => url.includes('index.twig'))).toBe(false);
    });

    it('does nothing when the developer does not confirm', async () => {
        inquirer.prompt.mockResolvedValue({ confirmPublish: false });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run outside an app directory', async () => {
        fs.rmSync(path.join(appDir, 'app.json'));

        await runPublish();

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run when app.json has no uuid', async () => {
        fsExtra.writeJsonSync(path.join(appDir, 'app.json'), { name: 'No uuid here' });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run when the session has expired', async () => {
        await saveToken({ access_token: 'token-abc', expires_at: Date.now() - 1 });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });
});
