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

const appLinkCommand = (await import('../src/commands/app-link.js')).default;
const { saveToken, saveSelectedPartner } = await import('../src/utils/auth.js');

const LOCAL_UUID = '01a0cf11-f8be-7430-ae15-502a5a9290d2';
const NEW_UUID = '019f7a1b-2c3d-7e4f-8a9b-0c1d2e3f4a5b';
const EXISTING_UUID = '019f0000-1111-7222-8333-444455556666';
const PARTNER_UUID = '0198aaaa-0000-7000-8000-000000000001';

describe('sitepack app:link', () => {
    let workDir;
    let appDir;

    const runLink = async (args = []) => {
        const program = new Command();
        program.exitOverride();
        appLinkCommand(program);
        await program.parseAsync(['node', 'sitepack', 'app:link', ...args]);
    };

    const readAppJson = () => fsExtra.readJsonSync(path.join(appDir, 'app.json'));

    const initCalls = () => axios.mock.calls.filter(([config]) => config.url.endsWith('/api/console/apps/init'));

    /** The server knows these apps for the selected partner; init issues NEW_UUID. */
    const serverWithApps = (apps) => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/api/console/apps/list')) {
                return { data: { status: 'success', apps } };
            }
            if (config.url.endsWith('/api/console/apps/init')) {
                return { data: { status: 'success', app: { uuid: NEW_UUID, name: config.data.name, version: 1 } } };
            }
            throw new Error(`Unexpected request ${config.url}`);
        });
    };

    beforeEach(async () => {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-home-'));
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitepack-work-'));
        appDir = path.join(workDir, 'exit-popup');

        vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
        vi.spyOn(process, 'cwd').mockReturnValue(workDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});

        axios.mockReset();
        inquirer.prompt.mockReset();
        spinner.succeed.mockClear();
        spinner.fail.mockClear();

        await saveToken({ access_token: 'token-abc', expires_at: Date.now() + 60_000 });
        await saveSelectedPartner(PARTNER_UUID);

        fsExtra.ensureDirSync(appDir);
        fsExtra.writeJsonSync(path.join(appDir, 'app.json'), { uuid: LOCAL_UUID, name: 'Exit popup', version: 1 });
    });

    afterEach(() => {
        fsExtra.removeSync(tempHome);
        fsExtra.removeSync(workDir);
    });

    it('registers a new app and writes its uuid when the organization has no apps', async () => {
        serverWithApps([]);

        await runLink(['exit-popup']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        const [[initConfig]] = initCalls();
        expect(initConfig.method).toBe('post');
        expect(initConfig.data).toEqual({ dirname: 'exit-popup', name: 'Exit popup', partner: PARTNER_UUID });
        expect(initConfig.headers['X-SitePack-Partner']).toBe(PARTNER_UUID);

        expect(readAppJson()).toEqual({ uuid: NEW_UUID, name: 'Exit popup', version: 1 });
    });

    it('keeps the rest of app.json and the key order intact', async () => {
        fsExtra.writeJsonSync(path.join(appDir, 'app.json'), { name: 'Exit popup', uuid: LOCAL_UUID, blocks: { body_end: 'exit_popup.twig' } });
        serverWithApps([]);

        await runLink(['exit-popup']);

        const appJson = readAppJson();
        expect(Object.keys(appJson)).toEqual(['name', 'uuid', 'blocks']);
        expect(appJson.blocks).toEqual({ body_end: 'exit_popup.twig' });
        expect(appJson.uuid).toBe(NEW_UUID);
    });

    it('puts a missing uuid on top of app.json', async () => {
        fsExtra.writeJsonSync(path.join(appDir, 'app.json'), { name: 'Exit popup', version: 1 });
        serverWithApps([]);

        await runLink(['exit-popup']);

        expect(Object.keys(readAppJson())).toEqual(['uuid', 'name', 'version']);
    });

    it('links to the current directory by default', async () => {
        process.cwd.mockReturnValue(appDir);
        serverWithApps([]);

        await runLink();

        expect(initCalls()[0][0].data.dirname).toBe('exit-popup');
        expect(readAppJson().uuid).toBe(NEW_UUID);
    });

    it('lets the developer register a new app when the organization has other apps', async () => {
        serverWithApps([{ uuid: EXISTING_UUID, name: 'Other app', version: 3 }]);
        inquirer.prompt.mockResolvedValue({ target: '__create_new__' });

        await runLink(['exit-popup']);

        expect(initCalls()).toHaveLength(1);
        expect(readAppJson().uuid).toBe(NEW_UUID);
    });

    it('lets the developer link to an existing app without registering one', async () => {
        serverWithApps([{ uuid: EXISTING_UUID, name: 'Exit popup (old)', version: 3 }]);
        inquirer.prompt.mockResolvedValue({ target: EXISTING_UUID });

        await runLink(['exit-popup']);

        expect(initCalls()).toHaveLength(0);
        expect(readAppJson().uuid).toBe(EXISTING_UUID);
    });

    it('leaves an already linked directory alone', async () => {
        serverWithApps([{ uuid: LOCAL_UUID, name: 'Exit popup', version: 2 }]);

        await runLink(['exit-popup']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(initCalls()).toHaveLength(0);
        expect(readAppJson().uuid).toBe(LOCAL_UUID);
    });

    it('registers a new app with --new, even when already linked', async () => {
        serverWithApps([{ uuid: LOCAL_UUID, name: 'Exit popup', version: 2 }]);

        await runLink(['exit-popup', '--new']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(initCalls()).toHaveLength(1);
        expect(readAppJson().uuid).toBe(NEW_UUID);
    });

    it('refuses a directory without app.json', async () => {
        fsExtra.removeSync(path.join(appDir, 'app.json'));

        await runLink(['exit-popup']);

        expect(axios).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('no app.json found'));
    });

    it('does not touch app.json when registering fails', async () => {
        axios.mockImplementation(async (config) => {
            if (config.url.endsWith('/api/console/apps/list')) {
                return { data: { status: 'success', apps: [] } };
            }
            return Promise.reject({
                message: 'Request failed with status code 400',
                response: { status: 400, headers: { 'content-type': 'application/json' }, data: { message: 'Partner not found or no access!' } },
            });
        });

        await runLink(['exit-popup']);

        expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Partner not found or no access!'));
        expect(readAppJson().uuid).toBe(LOCAL_UUID);
    });
});
