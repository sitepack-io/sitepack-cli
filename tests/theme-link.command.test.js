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
        stop: vi.fn(function () { return this; }),
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

const themeLinkCommand = (await import('../src/commands/theme-link.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const LOCAL_UUID = '01a0cf11-f8be-7430-ae15-502a5a9290d2';
const NEW_UUID = '019f7a1b-2c3d-7e4f-8a9b-0c1d2e3f4a5b';
const EXISTING_UUID = '019f0000-1111-7222-8333-444455556666';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

describe('sitepack theme:link', () => {
    let workDir;
    let themeDir;

    const runLink = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        themeLinkCommand(program);
        await program.parseAsync(['node', 'sitepack', 'theme:link', ...args]);
    };

    const readThemeJson = () => fsExtra.readJsonSync(path.join(themeDir, 'theme.json'));

    const initCalls = () => axios.mock.calls.filter(([config]) => config.url.endsWith('/api/console/themes/init'));

    /** The server knows these themes for the selected partner; init issues NEW_UUID. */
    const serverWithThemes = (themes) => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/api/console/themes/list')) {
                return { data: { status: 'success', themes } };
            }
            if (config.url.endsWith('/api/console/themes/init')) {
                return { data: { status: 'success', theme: { uuid: NEW_UUID, name: config.data.name, version: 1 } } };
            }
            throw new Error(`Unexpected request ${config.url}`);
        });
    };

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-work-'));
        themeDir = path.join(workDir, 'trailhead');

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(workDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        inquirer.prompt.mockReset();
        spinner.succeed.mockClear();
        spinner.fail.mockClear();

        await saveToken({ access_token: 'token-abc', expires_at: Date.now() + 60_000 });
        await saveSelectedPartner(PARTNER_UUID);

        fsExtra.ensureDirSync(themeDir);
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { uuid: LOCAL_UUID, name: 'Trailhead', author: 'SitePack', version: 1 });
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(workDir);
    });

    it('registers a new theme and writes its uuid when the organization has no themes', async () => {
        serverWithThemes([]);

        await runLink(['trailhead']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        const [[initConfig]] = initCalls();
        expect(initConfig.method).toBe('post');
        expect(initConfig.data).toEqual({ dirname: 'trailhead', name: 'Trailhead', partner: PARTNER_UUID });
        expect(initConfig.headers['X-SitePack-Partner']).toBe(PARTNER_UUID);

        expect(readThemeJson()).toEqual({ uuid: NEW_UUID, name: 'Trailhead', author: 'SitePack', version: 1 });
    });

    it('keeps the rest of theme.json and the key order intact', async () => {
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { name: 'Trailhead', uuid: LOCAL_UUID, author: 'SitePack', settings: [{ key: 'brand-color' }] });
        serverWithThemes([]);

        await runLink(['trailhead']);

        const themeJson = readThemeJson();
        expect(Object.keys(themeJson)).toEqual(['name', 'uuid', 'author', 'settings']);
        expect(themeJson.settings).toEqual([{ key: 'brand-color' }]);
        expect(themeJson.uuid).toBe(NEW_UUID);
    });

    it('links a theme whose uuid is empty, as agency themes are committed', async () => {
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { uuid: '', name: 'Trailhead', author: 'SitePack' });
        serverWithThemes([]);

        await runLink(['trailhead']);

        expect(readThemeJson()).toEqual({ uuid: NEW_UUID, name: 'Trailhead', author: 'SitePack' });
    });

    it('puts a missing uuid on top of theme.json', async () => {
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { name: 'Trailhead', author: 'SitePack', version: 1 });
        serverWithThemes([]);

        await runLink(['trailhead']);

        expect(Object.keys(readThemeJson())).toEqual(['uuid', 'name', 'author', 'version']);
    });

    it('fills an empty author from the logged-in account', async () => {
        fsExtra.writeJsonSync(path.join(themeDir, 'theme.json'), { uuid: '', name: 'Trailhead', author: '' });
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/api/authentication/oauth/whoami')) {
                return { data: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' } };
            }
            if (config.url.endsWith('/api/console/themes/list')) {
                return { data: { status: 'success', themes: [] } };
            }
            return { data: { status: 'success', theme: { uuid: NEW_UUID, name: 'Trailhead', version: 1 } } };
        });

        await runLink(['trailhead']);

        expect(readThemeJson().author).toBe('Ada Lovelace');
    });

    it('links to the current directory by default', async () => {
        process.cwd.mockReturnValue(themeDir);
        serverWithThemes([]);

        await runLink();

        expect(initCalls()[0][0].data.dirname).toBe('trailhead');
        expect(readThemeJson().uuid).toBe(NEW_UUID);
    });

    it('lets the developer register a new app when the organization has other themes', async () => {
        serverWithThemes([{ uuid: EXISTING_UUID, name: 'Other theme', version: 3 }]);
        inquirer.prompt.mockResolvedValue({ target: '__create_new__' });

        await runLink(['trailhead']);

        expect(initCalls()).toHaveLength(1);
        expect(readThemeJson().uuid).toBe(NEW_UUID);
    });

    it('lets the developer link to an existing theme without registering one', async () => {
        serverWithThemes([{ uuid: EXISTING_UUID, name: 'Trailhead (old)', version: 3 }]);
        inquirer.prompt.mockResolvedValue({ target: EXISTING_UUID });

        await runLink(['trailhead']);

        expect(initCalls()).toHaveLength(0);
        expect(readThemeJson().uuid).toBe(EXISTING_UUID);
    });

    it('leaves an already linked directory alone', async () => {
        serverWithThemes([{ uuid: LOCAL_UUID, name: 'Trailhead', version: 2 }]);

        await runLink(['trailhead']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(initCalls()).toHaveLength(0);
        expect(readThemeJson().uuid).toBe(LOCAL_UUID);
    });

    it('registers a new theme with --new, even when already linked', async () => {
        serverWithThemes([{ uuid: LOCAL_UUID, name: 'Trailhead', version: 2 }]);

        await runLink(['trailhead', '--new']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(initCalls()).toHaveLength(1);
        expect(readThemeJson().uuid).toBe(NEW_UUID);
    });

    it('refuses a directory without theme.json', async () => {
        fsExtra.removeSync(path.join(themeDir, 'theme.json'));

        await runLink(['trailhead']);

        expect(axios).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('no theme.json found'));
    });

    it('does not touch theme.json when registering fails', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/api/console/themes/list')) {
                return { data: { status: 'success', themes: [] } };
            }
            return Promise.reject({
                message: 'Request failed with status code 400',
                response: { status: 400, headers: { 'content-type': 'application/json' }, data: { message: 'Partner not found or no access!' } },
            });
        });

        await runLink(['trailhead']);

        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Partner not found or no access!'));
        expect(readThemeJson().uuid).toBe(LOCAL_UUID);
    });
});
