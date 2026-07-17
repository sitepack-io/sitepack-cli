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

const themePublishCommand = (await import('../src/commands/theme-publish.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const THEME_UUID = '019f6f6f-8e8a-72a3-91d4-625cf1274995';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

describe('sitepack theme:publish', () => {
    let themeDir;

    /** Runs the command exactly as the CLI entry point does. */
    const runPublish = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        themePublishCommand(program);
        await program.parseAsync(['node', 'sitepack', 'theme:publish', ...args]);
    };

    /** The requests the CLI made, as { method, url }. */
    const requests = () => axios.mock.calls.map(([config]) => ({ method: config.method, url: config.url }));

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-theme-'));

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(themeDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        axios.post?.mockReset();
        inquirer.prompt.mockReset();
        spinner.succeed.mockClear();
        spinner.fail.mockClear();

        // A logged-in developer, in a theme directory, who confirms the publish.
        await saveToken({ access_token: 'token-abc', expires_at: Date.now() + 60_000 });
        await saveSelectedPartner(PARTNER_UUID);
        inquirer.prompt.mockResolvedValue({ confirmPublish: true });

        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { uuid: THEME_UUID, name: 'Test Theme' });
        fsExtra.ensureDirSync(path.join(themeDir, 'templates'));
        fs.writeFileSync(path.join(themeDir, 'templates', 'index.twig'), '<h1>{{ title }}</h1>');
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(themeDir);
    });

    it('syncs the theme files and publishes a new version', async () => {
        axios.mockResolvedValue({ data: { status: 'ok', version: 4, new_theme_version: 4 } });

        await runPublish();

        const calls = requests();
        // Fresh marker, then the files, then publish.
        expect(calls[0].url).toBe(`https://sync.sitepack.dev/themes/${THEME_UUID}/`);
        expect(calls.map((c) => c.url)).toContain(`https://sync.sitepack.dev/themes/${THEME_UUID}/theme.json`);
        expect(calls.map((c) => c.url)).toContain(`https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`);
        expect(calls.at(-1).url).toBe(`https://sync.sitepack.dev/themes/${THEME_UUID}/publish`);

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('New version: 4'));
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('sends the theme and partner headers on every request', async () => {
        axios.mockResolvedValue({ data: { status: 'ok', version: 1 } });

        await runPublish();

        for (const [config] of axios.mock.calls) {
            expect(config.headers['X-Theme-Uuid']).toBe(THEME_UUID);
            expect(config.headers['X-SitePack-Partner']).toBe(PARTNER_UUID);
            expect(config.headers['X-SitePack-Access-Token']).toBe('token-abc');
        }
    });

    it('marks the sync as fresh so the server drops removed files', async () => {
        axios.mockResolvedValue({ data: { status: 'ok', version: 1 } });

        await runPublish();

        const [freshCall] = axios.mock.calls[0];
        expect(freshCall.headers['X-Fresh']).toBe('true');
    });

    /**
     * The publish endpoint reports the version as new_theme_version too; the CLI
     * used to only read "version" and silently dropped it from the message.
     */
    it('reports the version from new_theme_version', async () => {
        axios.mockResolvedValue({ data: { status: 'ok', new_theme_version: 9 } });

        await runPublish();

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('New version: 9'));
    });

    it('still reports success when the server returns no version', async () => {
        axios.mockResolvedValue({ data: { status: 'ok' } });

        await runPublish();

        expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('published successfully'));
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('shows the server message when publishing fails', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/publish')) {
                return Promise.reject({
                    response: { status: 400, data: { error: 'No files have been uploaded for this theme yet' } },
                });
            }
            return { data: { status: 'ok' } };
        });

        await runPublish();

        expect(spinner.fail).toHaveBeenCalledWith(
            expect.stringContaining('No files have been uploaded for this theme yet'),
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

        expect(requests().some((c) => c.url.endsWith('/publish'))).toBe(false);
        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('File type not allowed'));
    });

    it('aborts before uploading when a json file is invalid', async () => {
        fsExtra.ensureDirSync(path.join(themeDir, 'translations'));
        fs.writeFileSync(path.join(themeDir, 'translations', 'en.json'), '{ "hello": broken }');
        axios.mockResolvedValue({ data: { status: 'ok' } });

        await runPublish();

        // Only the fresh marker went out; no file was uploaded and nothing was published.
        const urls = requests().map((c) => c.url);
        expect(urls.some((url) => url.endsWith('theme.json'))).toBe(false);
        expect(urls.some((url) => url.endsWith('/publish'))).toBe(false);
        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Publish aborted'));
    });

    it('refuses to run when theme.json is not valid json', async () => {
        fs.writeFileSync(path.join(themeDir, 'theme.json'), '{ "uuid": broken }');

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('does nothing when the developer does not confirm', async () => {
        inquirer.prompt.mockResolvedValue({ confirmPublish: false });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run outside a theme directory', async () => {
        fs.rmSync(path.join(themeDir, 'theme.json'));

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run when theme.json has no uuid', async () => {
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { name: 'No uuid here' });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('refuses to run when the session has expired', async () => {
        await saveToken({ access_token: 'token-abc', expires_at: Date.now() - 1 });

        await runPublish();

        expect(axios).not.toHaveBeenCalled();
    });

    it('skips files that are not part of the theme structure', async () => {
        fs.writeFileSync(path.join(themeDir, 'notes.txt'), 'scratch');
        fsExtra.ensureDirSync(path.join(themeDir, 'node_modules', 'pkg'));
        fs.writeFileSync(path.join(themeDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
        fsExtra.ensureDirSync(path.join(themeDir, 'scratch'));
        fs.writeFileSync(path.join(themeDir, 'scratch', 'draft.twig'), 'draft');
        axios.mockResolvedValue({ data: { status: 'ok', version: 1 } });

        await runPublish();

        const urls = requests().map((c) => c.url);
        expect(urls.some((url) => url.includes('notes.txt'))).toBe(false);
        expect(urls.some((url) => url.includes('node_modules'))).toBe(false);
        expect(urls.some((url) => url.includes('scratch'))).toBe(false);
    });

    /**
     * The server only accepts theme.json at the theme root. The CLI used to
     * upload every root file, so a theme with a README.md — or the CLI's own
     * sitepack.config.json — had its whole publish rejected with a 422.
     */
    it('does not upload root files the server does not accept', async () => {
        fs.writeFileSync(path.join(themeDir, 'README.md'), '# My theme');
        fsExtra.writeJsonSync(path.join(themeDir, 'sitepack.config.json'), { base_url: 'http://core.local' });
        fs.writeFileSync(path.join(themeDir, 'package.json'), '{"name":"my-theme"}');
        axios.mockResolvedValue({ data: { status: 'ok', version: 1 } });

        await runPublish();

        const urls = requests().map((c) => c.url);
        expect(urls.some((url) => url.endsWith('README.md'))).toBe(false);
        expect(urls.some((url) => url.endsWith('sitepack.config.json'))).toBe(false);
        expect(urls.some((url) => url.endsWith('package.json'))).toBe(false);
        // theme.json is the one root file that is meant to go up.
        expect(urls.some((url) => url.endsWith('theme.json'))).toBe(true);
        expect(spinner.fail).not.toHaveBeenCalled();
    });

    it('honours .sitepackignore', async () => {
        fs.writeFileSync(path.join(themeDir, '.sitepackignore'), 'templates/index.twig\n');
        axios.mockResolvedValue({ data: { status: 'ok', version: 1 } });

        await runPublish();

        expect(requests().some((c) => c.url.includes('index.twig'))).toBe(false);
    });
});
