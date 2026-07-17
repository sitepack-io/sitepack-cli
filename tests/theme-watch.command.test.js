import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { Command } from 'commander';

vi.mock('axios');
vi.mock('ora', () => {
    const spinner = {
        start: vi.fn(function () { return this; }),
        succeed: vi.fn(function () { return this; }),
        fail: vi.fn(function () { return this; }),
        text: '',
    };
    return { default: vi.fn(() => spinner), __spinner: spinner };
});
// The watcher itself is the CLI staying alive; the test only drives the
// initial sync, so record the handlers instead of touching the filesystem.
vi.mock('chokidar', () => {
    const watcher = { on: vi.fn(function () { return this; }), close: vi.fn() };
    return { default: { watch: vi.fn(() => watcher) }, __watcher: watcher };
});
vi.mock('../src/utils/sites.js', () => ({
    getSites: vi.fn(async () => []),
    selectSite: vi.fn(),
}));

const axios = (await import('axios')).default;
const chokidar = (await import('chokidar')).default;

let tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));

const themeWatchCommand = (await import('../src/commands/theme-watch.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const THEME_UUID = '019f6f6f-8e8a-72a3-91d4-625cf1274995';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

describe('sitepack theme:watch', () => {
    let themeDir;

    const runWatch = async () => {
        const program = new Command();
        program.exitOverride();
        themeWatchCommand(program);
        await program.parseAsync(['node', 'sitepack', 'theme:watch']);
    };

    const syncedUrls = () => axios.mock.calls.map(([config]) => config.url);

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-theme-'));

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(themeDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        axios.mockResolvedValue({ data: { status: 'ok' } });
        chokidar.watch.mockClear();

        await saveToken({ access_token: 'token-abc', expires_at: Date.now() + 60_000 });
        await saveSelectedPartner(PARTNER_UUID);

        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { uuid: THEME_UUID, name: 'Test Theme' });
        fsExtra.ensureDirSync(path.join(themeDir, 'templates'));
        fs.writeFileSync(path.join(themeDir, 'templates', 'index.twig'), '<h1>{{ title }}</h1>');
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(themeDir);
    });

    it('syncs the theme files on start and then watches', async () => {
        await runWatch();

        const urls = syncedUrls();
        expect(urls).toContain(`https://sync.sitepack.dev/themes/${THEME_UUID}/theme.json`);
        expect(urls).toContain(`https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`);
        expect(chokidar.watch).toHaveBeenCalled();
    });

    /**
     * The server only accepts theme.json at the theme root, so syncing any other
     * root file just earns a 422.
     */
    it('does not sync root files the server does not accept', async () => {
        fs.writeFileSync(path.join(themeDir, 'README.md'), '# My theme');
        fsExtra.writeJsonSync(path.join(themeDir, 'sitepack.config.json'), { base_url: 'http://core.local' });

        await runWatch();

        const urls = syncedUrls();
        expect(urls.some((url) => url.endsWith('README.md'))).toBe(false);
        expect(urls.some((url) => url.endsWith('sitepack.config.json'))).toBe(false);
        expect(urls.some((url) => url.endsWith('theme.json'))).toBe(true);
    });

    it('does not sync directories outside the theme structure', async () => {
        fsExtra.ensureDirSync(path.join(themeDir, 'scratch'));
        fs.writeFileSync(path.join(themeDir, 'scratch', 'draft.twig'), 'draft');

        await runWatch();

        expect(syncedUrls().some((url) => url.includes('scratch'))).toBe(false);
    });

    it('watches the theme directories so their files are picked up', async () => {
        await runWatch();

        const { ignored } = chokidar.watch.mock.calls[0][1];

        // Theme directories and their contents must never be ignored.
        expect(ignored(path.join(themeDir, 'templates'))).toBe(false);
        expect(ignored(path.join(themeDir, 'templates', 'index.twig'))).toBe(false);
        expect(ignored(path.join(themeDir, 'assets', 'css', 'style.css'))).toBe(false);
        // Anything under an unknown directory is not part of the theme.
        expect(ignored(path.join(themeDir, 'scratch', 'draft.twig'))).toBe(true);
    });

    it('marks the initial sync as fresh', async () => {
        await runWatch();

        const [freshCall] = axios.mock.calls[0];
        expect(freshCall.headers['X-Fresh']).toBe('true');
    });

    it('refuses to run outside a theme directory', async () => {
        fs.rmSync(path.join(themeDir, 'theme.json'));

        await runWatch();

        expect(axios).not.toHaveBeenCalled();
        expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('refuses to run when the session has expired', async () => {
        await saveToken({ access_token: 'token-abc', expires_at: Date.now() - 1 });

        await runWatch();

        expect(axios).not.toHaveBeenCalled();
    });
});
