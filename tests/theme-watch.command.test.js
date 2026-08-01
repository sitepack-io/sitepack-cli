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
vi.mock('../src/utils/notify.js', () => ({ notifyFailure: vi.fn() }));

const axios = (await import('axios')).default;
const chokidarModule = await import('chokidar');
const chokidar = chokidarModule.default;
const watcherMock = chokidarModule.__watcher;
const { notifyFailure } = await import('../src/utils/notify.js');

let tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));

const themeWatchCommand = (await import('../src/commands/theme-watch.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const THEME_UUID = '019f6f6f-8e8a-72a3-91d4-625cf1274995';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

// Every run registers its own SIGINT handler; a real session only ever starts
// one watcher, so the warning node raises here is an artefact of the suite.
process.setMaxListeners(0);

describe('sitepack theme:watch', () => {
    let themeDir;

    const runWatch = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        themeWatchCommand(program);
        await program.parseAsync(['node', 'sitepack', 'theme:watch', ...args]);
    };

    const syncedUrls = () => axios.mock.calls.map(([config]) => config.url);

    /** The handler the CLI registered on the watcher for a chokidar event. */
    const watcherHandler = (event) => {
        const call = watcherMock.on.mock.calls.find(([name]) => name === event);
        if (!call) throw new Error(`The CLI never registered a "${event}" handler`);
        return call[1];
    };

    /** Whether any console.log line contains every one of the given fragments. */
    const logged = (...fragments) => console.log.mock.calls.some(
        ([line]) => fragments.every((fragment) => String(line).includes(fragment)),
    );

    /**
     * The watcher handlers do not return their promise, so wait for the work
     * they kicked off to settle before asserting on it.
     */
    const waitFor = async (predicate, timeout = 3000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error('Timed out waiting for the CLI to settle');
    };

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-theme-'));

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(themeDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        axios.mockResolvedValue({ data: { status: 'ok' } });
        chokidar.watch.mockClear();
        watcherMock.on.mockClear();
        notifyFailure.mockClear();

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

    it('retries a failed upload once and succeeds on the second attempt', async () => {
        const templateUrl = `https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`;
        let templateAttempts = 0;

        axios.mockImplementation(async (config) => {
            if (config.url === templateUrl) {
                templateAttempts += 1;
                if (templateAttempts === 1) {
                    return Promise.reject({ response: { status: 408 } });
                }
            }
            return { data: { status: 'ok' } };
        });

        await runWatch();

        // First attempt failed, retry made it through.
        expect(templateAttempts).toBe(2);
        const failed = console.log.mock.calls.some(([line]) => String(line).includes('Failed to sync templates/index.twig'));
        expect(failed).toBe(false);
        expect(logged('✓ Synced: templates/index.twig')).toBe(true);
        // A recovered upload is not worth interrupting the developer over.
        expect(notifyFailure).not.toHaveBeenCalled();
    });

    it('only mentions the retry in debug mode', async () => {
        const templateUrl = `https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`;
        let templateAttempts = 0;

        axios.mockImplementation(async (config) => {
            if (config.url === templateUrl) {
                templateAttempts += 1;
                if (templateAttempts === 1) {
                    return Promise.reject({ response: { status: 408 } });
                }
            }
            return { data: { status: 'ok' } };
        });

        await runWatch();
        expect(logged('[DEBUG] Retrying templates/index.twig')).toBe(false);

        console.log.mockClear();
        templateAttempts = 0;

        await runWatch(['--debug']);
        expect(logged('[DEBUG] Retrying templates/index.twig', 'HTTP 408')).toBe(true);
    });

    it('reports the failure after the retry is exhausted', async () => {
        const templateUrl = `https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`;
        let templateAttempts = 0;

        axios.mockImplementation(async (config) => {
            if (config.url === templateUrl) {
                templateAttempts += 1;
                return Promise.reject({ response: { status: 408 } });
            }
            return { data: { status: 'ok' } };
        });

        await runWatch();

        // The one upload plus one retry.
        expect(templateAttempts).toBe(2);
        const failed = console.log.mock.calls.some(([line]) =>
            String(line).includes('Failed to sync templates/index.twig') && String(line).includes('HTTP 408'));
        expect(failed).toBe(true);
    });

    /**
     * The developer is usually looking at their editor, not at the watch
     * window, so a definitive failure has to reach them.
     */
    it('alerts the developer when a file will not sync', async () => {
        const templateUrl = `https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`;

        axios.mockImplementation(async (config) => {
            if (config.url === templateUrl) {
                return Promise.reject({ response: { status: 500 } });
            }
            return { data: { status: 'ok' } };
        });

        await runWatch();

        expect(notifyFailure).toHaveBeenCalledWith('SitePack sync failed', 'Failed to sync templates/index.twig');
    });

    it('keeps watching after a file fails to sync', async () => {
        fsExtra.ensureDirSync(path.join(themeDir, 'snippets'));
        fs.writeFileSync(path.join(themeDir, 'snippets', 'footer.twig'), '<footer></footer>');

        const templateUrl = `https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`;
        axios.mockImplementation(async (config) => {
            if (config.url === templateUrl) {
                return Promise.reject({ response: { status: 500 } });
            }
            return { data: { status: 'ok' } };
        });

        await runWatch();

        // The failed file did not take the rest of the sync — or the watcher — with it.
        expect(syncedUrls()).toContain(`https://sync.sitepack.dev/themes/${THEME_UUID}/snippets/footer.twig`);
        expect(chokidar.watch).toHaveBeenCalled();
    });

    it('deletes a removed file from the server', async () => {
        await runWatch();
        const removed = path.join(themeDir, 'templates', 'index.twig');
        axios.mockClear();

        watcherHandler('unlink')(removed);
        await waitFor(() => logged('✓ Deleted: templates/index.twig'));

        const [config] = axios.mock.calls[0];
        expect(config.method).toBe('delete');
        expect(config.url).toBe(`https://sync.sitepack.dev/themes/${THEME_UUID}/templates/index.twig`);
        expect(config.headers['X-Theme-Uuid']).toBe(THEME_UUID);
        expect(config.headers['X-SitePack-Partner']).toBe(PARTNER_UUID);
    });

    it('retries a failed delete once and succeeds on the second attempt', async () => {
        await runWatch();
        const removed = path.join(themeDir, 'templates', 'index.twig');
        axios.mockClear();

        let attempts = 0;
        axios.mockImplementation(async () => {
            attempts += 1;
            if (attempts === 1) {
                return Promise.reject({ response: { status: 408 } });
            }
            return { data: { status: 'ok' } };
        });

        watcherHandler('unlink')(removed);
        await waitFor(() => logged('✓ Deleted: templates/index.twig'));

        expect(attempts).toBe(2);
        expect(notifyFailure).not.toHaveBeenCalled();
    });

    it('reports and alerts when a delete keeps failing', async () => {
        await runWatch();
        const removed = path.join(themeDir, 'templates', 'index.twig');
        axios.mockClear();

        let attempts = 0;
        axios.mockImplementation(async () => {
            attempts += 1;
            return Promise.reject({ response: { status: 500 } });
        });

        watcherHandler('unlink')(removed);
        await waitFor(() => logged('✗ Failed to delete templates/index.twig'));

        // The one delete plus one retry.
        expect(attempts).toBe(2);
        expect(logged('✗ Failed to delete templates/index.twig', 'HTTP 500')).toBe(true);
        expect(notifyFailure).toHaveBeenCalledWith('SitePack sync failed', 'Failed to delete templates/index.twig');
    });

    it('does not ask the server to delete files it never synced', async () => {
        await runWatch();
        axios.mockClear();

        watcherHandler('unlink')(path.join(themeDir, 'README.md'));
        watcherHandler('unlink')(path.join(themeDir, 'scratch', 'draft.twig'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(axios).not.toHaveBeenCalled();
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
